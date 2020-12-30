pragma solidity 0.5.11;

import "./ISeedSwap.sol";
import "./whitelist/WhitelistExtension.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/crowdsale/distribution/FinalizableCrowdsale.sol";


/// @dev SeedSwap contract for presale TEA token
/// Some notations:
/// dAmount - distributed token amount
/// uAmount - undistributed token amount
/// tAmount - token amount
/// eAmount - eth amount
contract SeedSwap is ISeedSwap, WhitelistExtension, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using SafeMath for uint128;

    IERC20  public constant ETH_ADDRESS = IERC20(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);
    // TODO: Change to constant
    uint256 public HARD_CAP = 400 ether;
    uint256 public MIN_INDIVIDUAL_CAP = 1 ether;
    uint256 public MAX_INDIVIDUAL_CAP = 10 ether;
    // user can call to distribute tokens after WITHDRAWAL_DEADLINE + saleEndTime
    uint256 public WITHDRAWAL_DEADLINE = 180 days;
    uint256 public SAFE_DISTRIBUTE_NUMBER = 150; // safe to distribute to 150 users at once
    uint256 public DISTRIBUTE_PERIOD_UNIT = 1 days;

    IERC20  public saleToken;
    uint256 public saleStartTime = 1609729200;  // 10:00:00, 4 Jan 2021 GMT+7
    uint256 public saleEndTime = 1610384340;    // 23:59:00, 11 Jan 2021 GMT+7
    uint256 public saleRate = 20000;            // 1 eth = 20,000 token

    // address to receive eth of presale, default owner
    address payable public ethRecipient;
    // total eth and token amounts that all users have swapped
    uint256 public totalSwappedEth = 0;
    uint256 public totalSwappedToken = 0;
    uint256 public totalDistributedToken = 0;

    struct SwapData {
        address user;
        uint128 eAmount; // eth amount
        uint128 tAmount; // token amount
        uint128 dAmount; // distributed token amount
        uint112 timestamp;
        uint16 daysID;
    }

    // all swaps that are made by users
    SwapData[] public listSwaps;

    struct UserSwapData {
        address tokenRecipient; // default is user's address, can change by owner
        uint128 eAmount;
        uint128 tAmount;
        uint128 dAmount;
        uint256[] ids; // indices in the listSwaps
    }

    // data of each user
    mapping(address => UserSwapData) public userSwapData;

    event SwappedEthToTea(
        address indexed trader,
        uint256 indexed ethAmount,
        uint256 indexed teaAmount,
        uint256 blockTimestamp,
        uint16 daysID
    );
    event UpdateSaleTimes(
        uint256 indexed newStartTime,
        uint256 newEndTime
    );
    event UpdateSaleRate(uint256 indexed newSaleRate);
    event UpdateEthRecipient(address indexed newRecipient);
    event Distributed(
        address indexed user,
        address indexed recipient,
        uint256 dAmount,
        uint256 indexed percentage,
        uint256 timestamp
    );
    event SelfWithdrawToken(
        address indexed sender,
        address indexed recipient,
        uint256 indexed dAmount,
        uint256 timestamp
    );
    event EmergencyOwnerWithdraw(
        address indexed sender,
        IERC20 indexed token,
        uint256 amount
    );
    event UpdatedTokenRecipient(
        address user,
        address recipient
    );

    modifier whenNotStarted() {
        require(block.timestamp < saleStartTime, "already started");
        _;
    }

    modifier whenNotEnded() {
        require(block.timestamp <= saleEndTime, "already ended");
        _;
    }

    modifier whenEnded() {
        require(block.timestamp > saleEndTime, "not ended yet");
        _;
    }

    modifier onlyValidPercentage(uint256 percentage) {
        require(0 < percentage && percentage <= 100, "percentage out of range");
        _;
    }

    /// @dev Conditions:
    /// 1. sale must be in progress
    /// 2. hard cap is not reached yet
    /// 3. user's swap eth amount is within individual caps
    /// 4. user is whitelisted
    /// 5. total user's eth amount is not higher than max user's cap
    /// 6. if total eth amount after the swap is higher than hard cap,
    ///     still allow user to swap if enough token balance
    /// Note: _paused is checked independently.
    modifier onlyCanSwap(uint256 ethAmount) {
        require(ethAmount > 0, "onlyCanSwap: amount is 0");
        // check sale is in progress
        require(block.timestamp >= saleStartTime, "onlyCanSwap: not started yet");
        require(block.timestamp <= saleEndTime, "onlyCanSwap: already ended");
        // check hardcap is not reached
        require(totalSwappedEth < HARD_CAP, "onlyCanSwap: HARD_CAP reached");
        // check individual cap
        require(
            ethAmount >= MIN_INDIVIDUAL_CAP && ethAmount <= MAX_INDIVIDUAL_CAP,
            "onlyCanSwap: eth amount must be within individual cap"
        );
        address sender = msg.sender;
        // check whitelisted
        require(isWhitelisted(sender), "onlyCanSwap: sender is not whitelisted");
        // check total user's swap eth amount <= max individual cap
        // note: no overflow here as amount has been checked within user's caps
        require(
            ethAmount + userSwapData[sender].eAmount <= MAX_INDIVIDUAL_CAP,
            "capSwap: max individual cap reached"
        );
        // only check token balance is enough to swap if hard cap is reached after this swap
        if (ethAmount + totalSwappedEth > HARD_CAP) {
            uint256 tokenAmount = _getTokenAmount(ethAmount);
            require(
                tokenAmount.add(totalSwappedToken) <= saleToken.balanceOf(address(this)),
                "capSwap: not enough token to swap"
            );
        }
        _;
    }

    constructor(address payable _owner, IERC20 _token) public {
        require(_token != IERC20(0), "constructor: invalid token");
        // (safe) check timestamp
        assert(block.timestamp < saleStartTime);
        assert(saleStartTime < saleEndTime);

        saleToken = _token;
        ethRecipient = _owner;

        // add owner as whitelisted admin and transfer ownership if needed
        if (msg.sender != _owner) {
            _addWhitelistAdmin(_owner);
            transferOwnership(_owner);
        }
    }

    function () external payable {
        swapEthToToken();
    }

    /// ================ UPDATE DEFAULT DATA ====================

    /// @dev the owner can update start and end times when it is not yet started
    function updateSaleTimes(uint256 _newStartTime, uint256 _newEndTime)
        external whenNotStarted onlyOwner
    {
        require(_newStartTime < _newEndTime, "Times: invalid start and end time");
        require(block.timestamp < _newStartTime, "Times: invalid start time");
        saleStartTime = _newStartTime;
        saleEndTime = _newEndTime;
        emit UpdateSaleTimes(_newStartTime, _newEndTime);
    }

    /// @dev the owner can update the sale rate whenever the sale is not ended yet
    function updateSaleRate(uint256 _newsaleRate)
        external whenNotEnded onlyOwner
    {
        // safe check rate not different more than 50% than the current rate
        require(_newsaleRate >= saleRate / 2, "Rates: new rate too low");
        require(_newsaleRate <= saleRate * 3 / 2, "Rates: new rate too high");

        saleRate = _newsaleRate;
        emit UpdateSaleRate(_newsaleRate);
    }

    /// @dev the owner can update the recipient of eth any time
    function updateEthRecipientAddress(address payable _newRecipient)
        external onlyOwner
    {
        require(_newRecipient != address(0), "Receipient: invalid eth recipient address");
        ethRecipient = _newRecipient;
        emit UpdateEthRecipient(_newRecipient);
    }

    /// ================ SWAP ETH TO TEA TOKEN ====================
    /// @dev user can call this function to swap eth to TEA token
    /// or just deposit eth directly to the contract
    function swapEthToToken()
        public payable
        nonReentrant
        whenNotPaused
        onlyCanSwap(msg.value)
        returns (uint256 tokenAmount)
    {
        address sender = msg.sender;
        uint256 ethAmount = msg.value;
        tokenAmount = _getTokenAmount(ethAmount);

        // should pass the check that presale has started, so no underflow here
        uint256 daysID = (block.timestamp - saleStartTime) / DISTRIBUTE_PERIOD_UNIT;
        assert(daysID < 2**16); // should have only few days for presale
        // record new swap
        SwapData memory _swapData = SwapData({
            user: sender,
            eAmount: uint128(ethAmount),
            tAmount: uint128(tokenAmount),
            dAmount: uint128(0),
            timestamp: uint112(block.timestamp),
            daysID: uint16(daysID)
        });
        listSwaps.push(_swapData);
        // update user swap data
        userSwapData[sender].eAmount += uint128(ethAmount);
        userSwapData[sender].tAmount += uint128(tokenAmount);
        userSwapData[sender].ids.push(listSwaps.length - 1);

        // update total swap eth and token amounts
        totalSwappedEth += msg.value;
        totalSwappedToken += tokenAmount;

        // transfer eth to recipient
        ethRecipient.transfer(msg.value);

        emit SwappedEthToTea(sender, ethAmount, tokenAmount, block.timestamp, uint16(daysID));
    }

    /// ================ DISTRIBUTE TOKENS ====================

    /// @dev admin can call this function to perform distribute to all eligible swaps
    /// @param percentage percentage of undistributed amount will be distributed
    /// @param daysID only distribute for swaps that were made at that day from start
    function distributeAll(uint256 percentage, uint16 daysID)
        external onlyWhitelistAdmin whenEnded whenNotPaused onlyValidPercentage(percentage)
        returns (uint256 totalAmount)
    {
        for(uint256 i = 0; i < listSwaps.length; i++) {
            if (listSwaps[i].daysID == daysID) {
                totalAmount += _distributedToken(i, percentage);
            }
        }
        totalDistributedToken = totalDistributedToken.add(totalAmount);
    }

    /// @dev admin can also use this function to distribute by batch,
    ///      in case distributeAll can be out of gas
    /// @param percentage percentage of undistributed amount will be distributed
    /// @param ids list of ids in the listSwaps to be distributed
    function distributeBatch(uint256 percentage, uint256[] calldata ids)
        external onlyWhitelistAdmin whenEnded whenNotPaused onlyValidPercentage(percentage)
        returns (uint256 totalAmount)
    {
        uint256 len = listSwaps.length;
        for(uint256 i = 0; i < ids.length; i++) {
            require(ids[i] < len, "Distribute: invalid id");
            // safe prevent duplicated ids in 1 batch
            if (i > 0) require(ids[i - 1] < ids[i], "Distribute: indices are not in order");
            totalAmount += _distributedToken(ids[i], percentage);
        }
        totalDistributedToken = totalDistributedToken.add(totalAmount);
    }

    /// ================ EMERGENCY FOR USER AND OWNER ====================

    /// @dev in case after WITHDRAWAL_DEADLINE from end sale time
    /// user can call this function to claim all of their tokens
    /// also update user's swap records
    function selfWithdrawToken() external returns (uint256 tokenAmount) {
        require(
            block.timestamp > WITHDRAWAL_DEADLINE + saleEndTime,
            "Emergency: not open for emergency withdrawal"
        );
        address sender = msg.sender;
        tokenAmount = userSwapData[sender].tAmount.sub(userSwapData[sender].dAmount);
        require(tokenAmount > 0, "Emergency: user has claimed all tokens");
        require(
            tokenAmount <= saleToken.balanceOf(address(this)),
            "Emergency: not enough token to distribute"
        );

        userSwapData[sender].dAmount = userSwapData[sender].tAmount;
        // update each user's record
        for(uint256 i = 0; i < userSwapData[sender].ids.length; i++) {
            uint256 id = userSwapData[sender].ids[i];
            // safe check
            assert(listSwaps[id].user == sender);
            // update distributed amount for each swap data
            listSwaps[id].dAmount = listSwaps[id].tAmount;
        }
        totalDistributedToken = totalDistributedToken.add(tokenAmount);
        // transfer token to user
        address recipient = _transferToken(sender, tokenAmount);
        emit SelfWithdrawToken(sender, recipient, tokenAmount, block.timestamp);
    }

    /// @dev emergency to allow owner withdraw eth or tokens inside the contract
    /// in case anything happens
    function emergencyOwnerWithdraw(IERC20 token, uint256 amount) external onlyOwner {
        if (token == ETH_ADDRESS) {
            // whenever someone transfer eth to this contract
            // it will either to the swap or revert
            // so there should be no eth inside the contract
            msg.sender.transfer(amount);
        } else {
            token.safeTransfer(msg.sender, amount);
        }
        emit EmergencyOwnerWithdraw(msg.sender, token, amount);
    }

    /// @dev only in case user has lost their wallet, or wrongly send eth from third party platforms
    function updateUserTokenRecipient(address user, address recipient) external onlyOwner {
        require(recipient != address(0), "invalid recipient");
        userSwapData[user].tokenRecipient = recipient;
        emit UpdatedTokenRecipient(user, recipient);
    }

    /// ================ GETTERS ====================
    function getNumberSwaps() external view returns (uint256) {
        return listSwaps.length;
    }

    function getAllSwaps()
        external view
        returns (
            address[] memory users,
            uint128[] memory ethAmounts,
            uint128[] memory tokenAmounts,
            uint128[] memory distributedAmounts,
            uint112[] memory timestamps,
            uint16[] memory daysIDs
        )
    {
        uint256 len = listSwaps.length;
        users = new address[](len);
        ethAmounts = new uint128[](len);
        tokenAmounts = new uint128[](len);
        distributedAmounts = new uint128[](len);
        timestamps = new uint112[](len);
        daysIDs = new uint16[](len);

        for(uint256 i = 0; i < len; i++) {
            SwapData memory data = listSwaps[i];
            users[i] = data.user;
            ethAmounts[i] = data.eAmount;
            tokenAmounts[i] = data.tAmount;
            distributedAmounts[i] = data.dAmount;
            timestamps[i] = data.timestamp;
            daysIDs[i] = data.daysID;
        }
    }

    /// @dev return full details data of a user
    function getUserSwapData(address user)
        external view 
        returns (
            address tokenRecipient,
            uint256 totalEthAmount,
            uint128 totalTokenAmount,
            uint128 distributedAmount,
            uint128 remainingAmount,
            uint128[] memory ethAmounts,
            uint128[] memory tokenAmounts,
            uint128[] memory distributedAmounts,
            uint112[] memory timestamps,
            uint16[] memory daysIDs
        )
    {
        tokenRecipient = _getRecipient(user);
        totalEthAmount = userSwapData[user].eAmount;
        totalTokenAmount = userSwapData[user].tAmount;
        distributedAmount = userSwapData[user].dAmount;
        remainingAmount = totalTokenAmount - distributedAmount;

        // record of all user's swaps
        uint256[] memory swapDataIDs = userSwapData[user].ids;
        ethAmounts = new uint128[](swapDataIDs.length);
        tokenAmounts = new uint128[](swapDataIDs.length);
        distributedAmounts = new uint128[](swapDataIDs.length);
        timestamps = new uint112[](swapDataIDs.length);
        daysIDs = new uint16[](swapDataIDs.length);

        for(uint256 i = 0; i < swapDataIDs.length; i++) {
            ethAmounts[i] = listSwaps[swapDataIDs[i]].eAmount;
            tokenAmounts[i] = listSwaps[swapDataIDs[i]].tAmount;
            distributedAmounts[i] = listSwaps[swapDataIDs[i]].dAmount;
            timestamps[i] = listSwaps[swapDataIDs[i]].timestamp;
            daysIDs[i] = listSwaps[swapDataIDs[i]].daysID;
        }
    }

    /// @dev returns list of users and distributed amounts if user calls distributeAll function
    /// in case anything is wrong, it will revert
    /// @param percentage percentage of undistributed amount will be distributed
    /// @param daysID only distribute for swaps that were made aat daysID from start
    function estimateDistributedAllData(
        uint128 percentage,
        uint16 daysID
    )
        external view
        whenEnded
        whenNotPaused
        onlyValidPercentage(percentage)
        returns(
            bool isSafe,
            uint256 totalUsers,
            uint256 totalDistributingAmount,
            uint256[] memory selectedIds,
            address[] memory users,
            address[] memory recipients,
            uint128[] memory distributingAmounts,
            uint16[] memory daysIDs
        )
    {
        // count number of data that can be distributed
        totalUsers = 0;
        for(uint256 i = 0; i < listSwaps.length; i++) {
            if (listSwaps[i].daysID == daysID && listSwaps[i].tAmount > listSwaps[i].dAmount) {
                totalUsers += 1;
            }
        }

        // return data that will be used to distribute
        selectedIds = new uint256[](totalUsers);
        users = new address[](totalUsers);
        recipients = new address[](totalUsers);
        distributingAmounts = new uint128[](totalUsers);
        daysIDs = new uint16[](totalUsers);

        uint256 counter = 0;
        for(uint256 i = 0; i < listSwaps.length; i++) {
            SwapData memory data = listSwaps[i];
            if (listSwaps[i].daysID == daysID && listSwaps[i].tAmount > listSwaps[i].dAmount) {
                selectedIds[counter] = i;
                users[counter] = data.user;
                recipients[counter] = _getRecipient(data.user);
                // don't need to use SafeMath here
                distributingAmounts[counter] = data.tAmount * percentage / 100;
                require(
                    distributingAmounts[counter] + data.dAmount <= data.tAmount,
                    "Estimate: total distribute more than 100%"
                );
                daysIDs[counter] = listSwaps[i].daysID;
                totalDistributingAmount += distributingAmounts[counter];
                counter += 1;
            }
        }
        require(
            totalDistributingAmount <= saleToken.balanceOf(address(this)),
            "Estimate: not enough token balance"
        );
        isSafe = totalUsers <= SAFE_DISTRIBUTE_NUMBER;
    }

    /// @dev returns list of users and distributed amounts if user calls distributeBatch function
    /// in case anything is wrong, it will revert
    function estimateDistributedBatchData(
        uint128 percentage,
        uint256[] calldata ids
    )
        external view
        whenEnded
        whenNotPaused
        onlyValidPercentage(percentage)
        returns(
            bool isSafe,
            uint256 totalUsers,
            uint256 totalDistributingAmount,
            uint256[] memory selectedIds,
            address[] memory users,
            address[] memory recipients,
            uint128[] memory distributingAmounts,
            uint16[] memory daysIDs
        )
    {
        totalUsers = 0;
        for(uint256 i = 0; i < ids.length; i++) {
            require(ids[i] < listSwaps.length, "Estimate: id out of range");
            if (i > 0) require(ids[i] > ids[i - 1], "Estimate: duplicated ids");
            // has undistributed amount
            if (listSwaps[i].tAmount > listSwaps[i].dAmount) totalUsers += 1;
        }
        // return data that will be used to distribute
        selectedIds = new uint256[](totalUsers);
        users = new address[](totalUsers);
        recipients = new address[](totalUsers);
        distributingAmounts = new uint128[](totalUsers);
        daysIDs = new uint16[](totalUsers);

        uint256 counter = 0;
        for(uint256 i = 0; i < ids.length; i++) {
            if (listSwaps[i].tAmount <= listSwaps[i].dAmount) continue;
            SwapData memory data = listSwaps[ids[i]];
            selectedIds[counter] = ids[i];
            users[counter] = data.user;
            recipients[counter] = _getRecipient(data.user);
            // don't need to use SafeMath here
            distributingAmounts[counter] = data.tAmount * percentage / 100;
            require(
                distributingAmounts[counter] + data.dAmount <= data.tAmount,
                "Estimate: total distribute more than 100%"
            );
            totalDistributingAmount += distributingAmounts[counter];
            daysIDs[counter] = listSwaps[i].daysID;
            counter += 1;
        }
        require(
            totalDistributingAmount <= saleToken.balanceOf(address(this)),
            "Estimate: not enough token balance"
        );
        isSafe = totalUsers <= SAFE_DISTRIBUTE_NUMBER;
    }

    /// @dev calculate amount token to distribute and send to user
    function _distributedToken(uint256 id, uint256 percentage)
        internal
        returns (uint256 distributingAmount)
    {
        SwapData memory data = listSwaps[id];
        distributingAmount = uint256(data.tAmount).mul(percentage).div(100);
        require(
            distributingAmount.add(data.dAmount) <= data.tAmount,
            "Distribute: total distribute more than 100%"
        );
        // percentage > 0, data.tAmount > 0
        assert (distributingAmount > 0);
        require(
            distributingAmount <= saleToken.balanceOf(address(this)),
            "Distribute: not enough token to distribute"
        );
        // no overflow, so don't need to use SafeMath here
        listSwaps[id].dAmount += uint128(distributingAmount);
        // by right, user's undistributed amount should be <= distributing amount
        assert(
            userSwapData[data.user].tAmount.sub(userSwapData[data.user].dAmount) >= uint128(distributingAmount)
        );
        // increase distributed amount for user, no overflow, so don't need to use SafeMath here
        userSwapData[data.user].dAmount += uint128(distributingAmount);
        // send token to user's wallet
        address recipient = _transferToken(data.user, distributingAmount);
        emit Distributed(data.user, recipient, distributingAmount, percentage, block.timestamp);
    }

    function _transferToken(address user, uint256 amount) internal returns (address recipient) {
        recipient = _getRecipient(user);
        // safe check
        assert(recipient != address(0));
        saleToken.safeTransfer(recipient, amount);
    }

    function _getRecipient(address user) internal view returns(address recipient) {
        recipient = userSwapData[user].tokenRecipient;
        if (recipient == address(0)) {
            recipient = user;
        }
    }

    /// @dev return received tokenAmount given ethAmount
    /// note that token decimals is 18
    function _getTokenAmount(uint256 ethAmount) internal view returns (uint256) {
        return ethAmount.mul(saleRate);
    }
}
