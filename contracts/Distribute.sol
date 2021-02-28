
pragma solidity 0.5.11;


import "@openzeppelin/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Distribute is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public token;
    mapping (address => uint256) internal claimableAmounts;

    constructor(IERC20 _token) public Ownable() {
        token = _token;
    }

    function fastDistribute(
        address[] calldata users,
        uint256[] calldata amounts,
        bool needCollectToken
    )
        external onlyOwner
    {
        require(users.length == amounts.length, "invalid lengths");
        uint256 totalAmount = 0;
        for(uint256 i = 0; i < amounts.length; i++) {
            totalAmount += amounts[i];
        }

        if (needCollectToken) {
            token.safeTransferFrom(msg.sender, address(this), totalAmount);
        } else {
            require(token.balanceOf(address(this)) >= totalAmount, "insuffient token balance");
        }

        for(uint256 i = 0; i < amounts.length; i++) {
            require(users[i] != address(0), "invalid user");
            require(amounts[i] > 0, "invalid amount");
            token.safeTransfer(users[i], amounts[i]);
        }
    }

    function setUserData(address[] calldata users, uint256[] calldata amounts)
        external onlyOwner
    {
        require(users.length == amounts.length, "invalid lengths");
        for(uint256 i = 0; i < amounts.length; i++) {
            require(users[i] != address(0), "invalid user");
            require(amounts[i] > 0, "invalid amount");
            claimableAmounts[users[i]] = amounts[i];
        }
    }

    function distribute(address[] calldata users, bool needCollectToken)
        external onlyOwner
    {
        uint256 totalAmount = 0;
        for(uint256 i = 0; i < users.length; i++) {
            totalAmount += claimableAmounts[users[i]];
        }

        if (needCollectToken) {
            token.safeTransferFrom(msg.sender, address(this), totalAmount);
        } else {
            require(token.balanceOf(address(this)) >= totalAmount, "insuffient token balance");
        }

        for(uint256 i = 0; i < users.length; i++) {
            require(users[i] != address(0), "invalid user");
            uint256 amount = claimableAmounts[users[i]];
            claimableAmounts[users[i]] = 0;
            if (amount > 0) {
                token.safeTransfer(users[i], amount);
            }
        }
    }

    function withdrawToken(IERC20 _token, uint256 amount) external onlyOwner {
        if (_token == IERC20(0)) {
            // withdraw eth
            msg.sender.transfer(amount);
        } else {
            _token.safeTransfer(msg.sender, amount);
        }
    }

    function getClaimableAmount(address user) external view returns (uint256) {
        return claimableAmounts[user];
    }

    function getTotalDistributeAmount(address[] calldata users)
        external view returns (uint256 totalAmount)
    {
        for(uint256 i = 0; i < users.length; i++) {
            totalAmount += claimableAmounts[users[i]];
        }
    }
}
