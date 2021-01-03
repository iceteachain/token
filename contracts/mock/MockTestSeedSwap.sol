pragma solidity 0.5.11;


import "../SeedSwap.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockTestSeedSwap is SeedSwap {
    constructor(
        address payable _owner,
        IERC20 _token,
        uint256 startTime,
        uint256 endTime,
        uint256 hardCap,
        uint256 maxUserCap
    ) public SeedSwap(_owner, _token) {
        saleStartTime = startTime;
        saleEndTime = endTime;
        // _addWhitelisted(msg.sender);
        // HARD_CAP = hardCap;
        // MIN_INDIVIDUAL_CAP = 10**10;
        // MAX_INDIVIDUAL_CAP = maxUserCap;
        // WITHDRAWAL_DEADLINE = 300 seconds; // 5 mins after ended
        // DISTRIBUTE_PERIOD_UNIT = 5 seconds; // change unit from 1 day to 5 second
        // SAFE_DISTRIBUTE_NUMBER = 5;
    }
}
