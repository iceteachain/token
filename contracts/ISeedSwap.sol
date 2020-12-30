pragma solidity 0.5.11;



contract ISeedSwap {
    function swapEthToToken() external payable returns (uint256 tokenAmount);
    function distributeAll(uint256 percentage, uint16 daysID) external returns (uint256 totalAmount);
    function distributeBatch(uint256 percentage, uint256[] calldata ids) external returns (uint256 totalAmount);
    function selfWithdrawToken() external returns (uint256 tokenAmount);
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
        );
}
