pragma solidity 0.5.11;

import "./whitelist/WhitelistExtension.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/crowdsale/distribution/FinalizableCrowdsale.sol";


/// @dev SeedSwap contract for presale PKF token
/// Some notations:
/// dAmount - distributed token amount
/// uAmount - undistributed token amount
/// tAmount - token amount
/// eAmount - eth amount
contract SeedSwap is WhitelistExtension, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using SafeMath for uint80;

    IERC20  public constant ETH_ADDRESS = IERC20(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);
    uint256 public constant MAX_UINT_80 = 2**79 - 1;
    uint256 public constant HARD_CAP = 320 ether;
    uint256 public constant MIN_INDIVIDUAL_CAP = 1 ether;
    uint256 public constant MAX_INDIVIDUAL_CAP = 10 ether;
    // user can call to distribute tokens after WITHDRAWAL_DEADLINE + saleEndTime
    uint256 public constant WITHDRAWAL_DEADLINE = 180 days;
    uint256 public constant SAFE_DISTRIBUTE_NUMBER = 150; // safe to distribute to 150 users at once
    uint256 public constant DISTRIBUTE_PERIOD_UNIT = 1 days;

    IERC20  public saleToken;
    uint256 public saleStartTime = 1609693200;  // 00:00:00, 4 Jan 2021 GMT+7
    uint256 public saleEndTime = 1610384340;    // 23:59:00, 11 Jan 2021 GMT+7
    uint256 public saleRate = 25000;            // 1 eth = 25,000 token

    // address to receive eth of presale, default owner
    address payable public ethRecipient;
    // total eth and token amounts that all users have swapped
    struct TotalSwappedData {
        uint128 eAmount;
        uint128 tAmount;
    }
    TotalSwappedData public totalData;
    uint256 public totalDistributedToken = 0;

    struct SwapData {
        address user;
        uint80 eAmount; // eth amount
        uint80 tAmount; // token amount
        uint80 dAmount; // distributed token amount
        uint16 daysID;
    }

    // all swaps that are made by users
    SwapData[] public listSwaps;

    // list indices of user's swaps in listSwaps array
    mapping(address => uint256[]) public userSwapData;
    mapping(address => address) public userTokenRecipient;

    event SwappedEthToPkf(
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
    /// 3. user's total swapped eth amount is within individual caps
    /// 4. user is whitelisted
    /// 5. if total eth amount after the swap is higher than hard cap, still allow
    /// Note: _paused is checked independently.
    modifier onlyCanSwap(uint256 ethAmount) {
        require(ethAmount > 0, "onlyCanSwap: amount is 0");
        // check sale is in progress
        uint256 timestamp = block.timestamp;
        require(timestamp >= saleStartTime, "onlyCanSwap: not started yet");
        require(timestamp <= saleEndTime, "onlyCanSwap: already ended");
        // check hardcap is not reached
        require(totalData.eAmount < HARD_CAP, "onlyCanSwap: HARD_CAP reached");
        address sender = msg.sender;
        // check whitelisted
        require(isWhitelisted(sender), "onlyCanSwap: sender is not whitelisted");
        // check total user's swap eth amount is within individual cap
        (uint80 userEthAmount, ,) = _getUserSwappedAmount(sender);
        uint256 totalEthAmount = ethAmount.add(uint256(userEthAmount));
        require(
            totalEthAmount >= MIN_INDIVIDUAL_CAP,
            "onlyCanSwap: eth amount is lower than min individual cap"
        );
        require(
            totalEthAmount <= MAX_INDIVIDUAL_CAP,
            "onlyCapSwap: max individual cap reached"
        );
        _;
    }

    constructor(address payable _owner, IERC20 _token) public {
        require(_token != IERC20(0), "constructor: invalid token");
        // (safe) check timestamp
        // assert(block.timestamp < saleStartTime);
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
        if (_newStartTime != 0) saleStartTime = _newStartTime;
        if (_newEndTime != 0) saleEndTime = _newEndTime;
        require(saleStartTime < saleEndTime, "Times: invalid start and end time");
        require(block.timestamp < saleStartTime, "Times: invalid start time");
        emit UpdateSaleTimes(saleStartTime, saleEndTime);
    }

    /// @dev the owner can update the sale rate whenever the sale is not ended yet
    function updateSaleRate(uint256 _newsaleRate)
        external whenNotEnded onlyOwner
    {
        require(
            _newsaleRate < MAX_UINT_80 / MAX_INDIVIDUAL_CAP,
            "Rates: new rate is out of range"
        );
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

    /// ================ SWAP ETH TO PKF TOKEN ====================
    /// @dev user can call this function to swap eth to PKF token
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
            eAmount: uint80(ethAmount),
            tAmount: uint80(tokenAmount),
            dAmount: uint80(0),
            daysID: uint16(daysID)
        });
        listSwaps.push(_swapData);
        // update user swap data
        userSwapData[sender].push(listSwaps.length - 1);

        // update total swap eth and token amounts
        TotalSwappedData memory swappedData = totalData;
        totalData = TotalSwappedData({
            eAmount: swappedData.eAmount + uint128(ethAmount),
            tAmount: swappedData.tAmount + uint128(tokenAmount)
        });

        // transfer eth to recipient
        ethRecipient.transfer(ethAmount);

        emit SwappedEthToPkf(sender, ethAmount, tokenAmount, block.timestamp, uint16(daysID));
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
        (, uint80 tAmount, uint80 dAmount) = _getUserSwappedAmount(sender);
        tokenAmount = tAmount.sub(dAmount);
        require(tokenAmount > 0, "Emergency: user has claimed all tokens");
        require(
            tokenAmount <= saleToken.balanceOf(address(this)),
            "Emergency: not enough token to distribute"
        );

        // update each user's record
        uint256[] memory ids = userSwapData[sender];
        for(uint256 i = 0; i < ids.length; i++) {
            // safe check
            assert(listSwaps[ids[i]].user == sender);
            // update distributed amount for each swap data
            listSwaps[ids[i]].dAmount = listSwaps[ids[i]].tAmount;
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
        userTokenRecipient[user] = recipient;
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
            uint80[] memory ethAmounts,
            uint80[] memory tokenAmounts,
            uint80[] memory distributedAmounts,
            uint16[] memory daysIDs
        )
    {
        uint256 len = listSwaps.length;
        users = new address[](len);
        ethAmounts = new uint80[](len);
        tokenAmounts = new uint80[](len);
        distributedAmounts = new uint80[](len);
        daysIDs = new uint16[](len);

        for(uint256 i = 0; i < len; i++) {
            SwapData memory data = listSwaps[i];
            users[i] = data.user;
            ethAmounts[i] = data.eAmount;
            tokenAmounts[i] = data.tAmount;
            distributedAmounts[i] = data.dAmount;
            daysIDs[i] = data.daysID;
        }
    }

    /// @dev return full details data of a user
    function getUserSwapData(address user)
        external view 
        returns (
            address tokenRecipient,
            uint256 totalEthAmount,
            uint80 totalTokenAmount,
            uint80 distributedAmount,
            uint80 remainingAmount,
            uint80[] memory ethAmounts,
            uint80[] memory tokenAmounts,
            uint80[] memory distributedAmounts,
            uint16[] memory daysIDs
        )
    {
        tokenRecipient = _getRecipient(user);
        (totalEthAmount, totalTokenAmount, distributedAmount) = _getUserSwappedAmount(user);
        remainingAmount = totalTokenAmount - distributedAmount;

        // record of all user's swaps
        uint256[] memory swapDataIDs = userSwapData[user];
        ethAmounts = new uint80[](swapDataIDs.length);
        tokenAmounts = new uint80[](swapDataIDs.length);
        distributedAmounts = new uint80[](swapDataIDs.length);
        daysIDs = new uint16[](swapDataIDs.length);

        for(uint256 i = 0; i < swapDataIDs.length; i++) {
            ethAmounts[i] = listSwaps[swapDataIDs[i]].eAmount;
            tokenAmounts[i] = listSwaps[swapDataIDs[i]].tAmount;
            distributedAmounts[i] = listSwaps[swapDataIDs[i]].dAmount;
            daysIDs[i] = listSwaps[swapDataIDs[i]].daysID;
        }
    }

    function getData()
        external view
        returns(
            uint256 _startTime,
            uint256 _endTime,
            uint256 _rate,
            address _ethRecipient,
            uint128 _tAmount,
            uint128 _eAmount,
            uint256 _hardcap
        )
    {
        _startTime = saleStartTime;
        _endTime = saleEndTime;
        _rate = saleRate;
        _ethRecipient = ethRecipient;
        _tAmount = totalData.tAmount;
        _eAmount = totalData.eAmount;
        _hardcap = HARD_CAP;
    }

    /// @dev returns list of users and distributed amounts if user calls distributeAll function
    /// in case anything is wrong, it will fail and not return anything
    /// @param percentage percentage of undistributed amount will be distributed
    /// @param daysID only distribute for swaps that were made at daysID from start
    function estimateDistributedAllData(
        uint80 percentage,
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
            uint80[] memory distributingAmounts,
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
        distributingAmounts = new uint80[](totalUsers);
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
    /// in case anything is wrong, it will fail and not return anything
    /// @param percentage percentage of undistributed amount will be distributed
    /// @param ids list indices to distribute in listSwaps
    /// ids must be in asc order
    function estimateDistributedBatchData(
        uint80 percentage,
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
            uint80[] memory distributingAmounts,
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
        distributingAmounts = new uint80[](totalUsers);
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
        listSwaps[id].dAmount += uint80(distributingAmount);
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
        recipient = userTokenRecipient[user];
        if (recipient == address(0)) {
            recipient = user;
        }
    }

    /// @dev return received tokenAmount given ethAmount
    /// note that token decimals is 18
    function _getTokenAmount(uint256 ethAmount) internal view returns (uint256) {
        return ethAmount.mul(saleRate);
    }

    function _getUserSwappedAmount(address sender)
        internal view returns(
            uint80 eAmount,
            uint80 tAmount,
            uint80 dAmount
        )
    {
        uint256[] memory ids = userSwapData[sender];
        for(uint256 i = 0; i < ids.length; i++) {
            SwapData memory data = listSwaps[ids[i]];
            eAmount += data.eAmount;
            tAmount += data.tAmount;
            dAmount += data.dAmount;
        }
    }
}
