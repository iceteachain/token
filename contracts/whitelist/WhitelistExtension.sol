pragma solidity 0.5.11;

import "@openzeppelin/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts/access/roles/WhitelistedRole.sol";


/// @dev Extension of WhitelistedRole to allow add multiple whitelisted admins or accounts
/// in a single transaction
/// also added Pausable
contract WhitelistExtension is Ownable, WhitelistedRole {

    event Paused(address account);
    event Unpaused(address account);

    bool private _paused;

    modifier whenNotPaused() {
        require(!_paused, "paused");
        _;
    }

    modifier whenPaused() {
        require(_paused, "not paused");
        _;
    }

    constructor() public {
        _paused = false;
    }

    function pause() public onlyWhitelistAdmin whenNotPaused {
        _paused = true;
        emit Paused(msg.sender);
    }

    function unpause() public onlyWhitelistAdmin whenPaused {
        _paused = false;
        emit Unpaused(msg.sender);
    }

    /// @dev update whitelisted admins
    /// only owner can update this list
    function updateWhitelistedAdmins(
        address[] calldata admins,
        bool isAdd
    )
        external onlyOwner
    {
        for(uint256 i = 0; i < admins.length; i++) {
            if (isAdd) {
                if (!isWhitelistAdmin(admins[i])) _addWhitelistAdmin(admins[i]);
            } else {
                if (isWhitelistAdmin(admins[i])) _removeWhitelistAdmin(admins[i]);
            }
        }
    }

    /// @dev update whitelisted addresses
    /// only whitelisted admins can call this function
    function updateWhitelistedUsers(
        address[] calldata users,
        bool isAdd
    )
        external onlyWhitelistAdmin 
    {
        for(uint256 i = 0; i < users.length; i++) {
            if (isAdd) {
                if (!isWhitelisted(users[i])) _addWhitelisted(users[i]);
            } else {
                if (isWhitelisted(users[i])) _removeWhitelisted(users[i]);
            }
        }
    }

    function isPaused() external view returns (bool) {
        return _paused;
    }
}
