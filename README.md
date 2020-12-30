# Introduction

[![built-with openzeppelin](https://img.shields.io/badge/built%20with-OpenZeppelin-3677FF)](https://docs.openzeppelin.com/)
[![Build Status](https://api.travis-ci.com/KyberNetwork/kyber_reserves_sc.svg?branch=master&status=passed)](https://travis-ci.com/github/KyberNetwork/kyber_reserves_sc)


TeaToken and Crowdsale contracts.

## Package Manager
We use `yarn` as the package manager. You may use `npm` and `npx` instead, but commands in bash scripts may have to be changed accordingly.


## Setup
1. Clone this repo
2. `yarn install`


## Compilation with Buidler
`yarn compile` to compile contracts for all solidity versions or `./compile.sh`


## Contract Deployment / Interactions

For interactions or contract deployments on public testnets / mainnet, create a `.env` file specifying your private key and infura api key, with the following format:

```
PRIVATE_KEY=0x****************************************************************
INFURA_API_KEY=********************************
```

## Testing with Buidler
1. If contracts have not been compiled, run `yarn compile` or `./compile.sh`. This step can be skipped subsequently.
2. Run `yarn test` or `./test.sh`
3. Use `./test.sh -f` for running a specific test file.

### Example Commands
- `yarn test` (Runs all tests)
- `./test.sh -f ./tests/xxx.js`

### Example
`yarn hardhat test --no-compile ./test/xxx.js`

### Coverage with `buidler-coverage`
- Run `./coverage.sh` for coverage on files


## Interaction

### Owner
1. Check owner: `owner()`
2. Transfer ownership: `transferOwnership(newOwner)`: only `owner` can call this function to transfer ownership to `newOwner`

### Admins
1. Check if an address is admin: `isWhitelistAdmin(address)`
2. Add admins:
    - `addWhitelistAdmin(address)`: Add single admin, only whitelist admins can call this function to add new admin, revert if the address is already an admin.
    - `updateWhitelistedAdmins(newAdmins, true)`: Add multiple admin, only `owner` can call this function to add multiple admins, it's not reverted if the address is already an admin
3. Remove admins:
    - `renounceWhitelistAdmin()`: Remove single admin, only an admin can call this function, and will remove the sender from admin list, revert if sender is not an admin.
    - `updateWhitelistedAdmins(admins, false)`: Remove multiple admins, only `owner` can call this function to remove multiple admins, it's not reverted if the address is not an admin.

### Whitelist users
1. Check if an address is whitelisted: `isWhitelisted(address)`
2. Add new whitelist users:
    - `addWhitelisted(user)`: Add single user, only whitelisted admin can call this function to add new whitelisted user, revert if user is already whitelisted.
    - `updateWhitelistedUsers(users, true)`: Add multiple users, only an admin can call this function to add multiple users as whitelisted, not revert if users are already whitelisted.
3. Remove whitelist users:
    - `removeWhitelisted(user)`: Remove single user, only an admin can call this function to remove single user from whitelisted.
    - `updateWhitelistedUsers(users, false)`: Remove multiple users, only an admin can call this function.

### Update data
1. `updateSaleTimes(startTime, endTime)`: Update sale times, only `owner` can call this function to update new start and end time, only when it is not started yet.
2. `updateSaleRate(newSaleRate)`: Update sale rate, only `owner` can call this function to update new sale rate.
3. `updateEthRecipientAddress(address)`: Update eth recipient, only `owner` can call this function to update new eth recipient address, default is `owner`.
4. pause/unpause: `pause()` or `unpause()` only admin can call these functions to pause or unpause. Default is not paused.

### Swap
1. Transfer `eth` directly to the contract, increase gas limit to around 250,000.
2. Call `swapEthToToken` and set eth value for the transaction.

Only can swap if:
- sale is in progres.
- sale is not paused.
- HARD_CAP is not reached yet.
- Sender is whitelisted.
- Eth value is within individual cap.
- Total eth value <= max individual cap.
- If after this swap, total swapped eth > HARD_CAP, must check if contract has enough token for this new swap.

### Distribute
1. `distributeAll(percentage, daysID)`: Distribute all, only admin can call this function to perform the distribution.
    - `percentage`: % of token amount should be distributed, total <= 100% for each swap, revert if total > 100%.
    - `daysID`: all users that swapped in `daysID` since the start time will be distributed, start from 0.
2. `distributeBatch(percentage, ids)`: Distribute batch, only admin can call this function.
    - `percentage`: % of token amount should be distributed, total <= 100% for each swap, revert if total > 100%.
    - `ids`: ids of swaps that will be distributed.

Only can call distribute after sale is ended and it is not paused.

### Emergency owner withdraw
- `emergencyOwnerWithdraw(token, amount)`: withdraw `amount` of `token` to the owner address.
- Owner can withdraw eth or any token at any time.

### Emergency user withdraw token
- `selfWithdrawToken()`
- User can withdraw TEA token after `WITHDRAWAL_DEADLINE` from `saleEndTime`.
- All undistributed tokens will be transferred to user.


### Get data
1. `saleRate()`: Return sale rate.
2. `saleStartTime()`: Return sale start time.
3. `saleEndTime()`: Return sale end time.
4. `saleToken()`: Return address of sale token.
5. `ethRecipient()`: Return address that will receive eth.
6. `getNumberSwaps()`: Return number of swaps from all users.
7. `getAllSwaps()`: Return all swaps data.
8. `listSwaps(index)`: Return data of a single swap.
9. `totalSwappedEth()`: Return total eth has been received.
10. `totalSwappedToken()`: Return total token that should be distributed.
11. `totalDistributedToken()`: Return total distributed token amount.
12. `getUserSwapData(user)`: Return data of an user.
13. `estimateDistributedAllData(percentage, daysID)`: Estimate distribute all.
    - Return info of swap orders that will be distributed.
    - `isSafe` safe if the number of orders <= SAFE_DISTRIBUTE_NUMBER (default: 150).
14. `estimateDistributedBatchData(percentage, ids)`: Estimate distribute batch.
    - Return info of swap orders that will be distributed.
    - `isSafe` safe if the number of orders <= SAFE_DISTRIBUTE_NUMBER (default: 150).
15. `isPaused()`: check if it is paused.
4. Some constants: `HARD_CAP()`, `MAX_INDIVIDUAL_CAP()`, `MIN_INDIVIDUAL_CAP()`, `SAFE_DISTRIBUTE_NUMBER()`, `WITHDRAWAL_DEADLINE()`, `DISTRIBUTE_PERIOD_UNIT()`


### Swap data
```
    struct SwapData {
        address user;
        uint128 eAmount;    // eth amount
        uint128 tAmount;    // bought token amount
        uint128 dAmount;    // distributed token amount
        uint112 timestamp;
        uint16 daysID;
    }
```

### User data
```
    struct UserSwapData {
        uint128 eAmount;    // total eth
        uint128 tAmount;    // total bought token
        uint128 dAmount;    // total distributed token
        uint256[] ids; // indices in the list all swaps
    }
```
