pragma solidity 0.5.11;


import "../SeedSwap.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockDeploySeedSwap is SeedSwap {
    constructor(IERC20 _token) public SeedSwap(msg.sender, _token) {
        saleStartTime = block.timestamp;
        saleEndTime = saleStartTime + 300 seconds; // end after 5 mins
        // _addWhitelisted(msg.sender);
        // HARD_CAP = 10**16;
        // MIN_INDIVIDUAL_CAP = 10;
        // MAX_INDIVIDUAL_CAP = 10**18;
    }
}
