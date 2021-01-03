pragma solidity 0.5.11;

import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";

contract TeaToken is ERC20Detailed, ERC20Burnable {

    uint256 public constant INITIAL_SUPPLY = 200 * 10**(6 + 18); // 200M tokens

    constructor(address owner) public ERC20Detailed("TEA Token", "TEA", 18) {
        _mint(owner, INITIAL_SUPPLY);
    }
}
