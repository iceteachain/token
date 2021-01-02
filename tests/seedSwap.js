const TeaToken = artifacts.require('TeaToken.sol');
const SeedSwap = artifacts.require('SeedSwap.sol');
const MockTestSeedSwap = artifacts.require('MockTestSeedSwap.sol');

const BN = web3.utils.BN;

const Helper = require('./helper');
const { ethAddress, address0 } = require('./helper');
const {expectRevert, expectEvent} = require('@openzeppelin/test-helpers');

let teaToken;
let seedSwap;
let deployer;
let admin;
let owner;
let user;
let ethAmount = new BN(10).pow(new BN(15));

let userData = {}
let swapObjects = [];
let currentEthSwapped;
let currentTokenSwapped;
let totalDistributed;
let userTokenBalances = {};

contract('SeedSwap', accounts => {
  describe('Test SeedSwap main functions', async () => {
    before('test trade in uniswap curve', async () => {
      deployer = accounts[0];
      admin = accounts[1];
      owner = accounts[2];
      user = accounts[3];
      teaToken = await TeaToken.new(owner);
      seedSwap = await SeedSwap.new(owner, teaToken.address, { from: deployer });
    });

    describe(`Test Constructor`, async() => {
      it(`Test data correct after deployed, owner != deployer`, async() => {
        seedSwap = await SeedSwap.new(owner, teaToken.address, { from: deployer });
        Helper.assertEqual(teaToken.address, await seedSwap.saleToken());
        Helper.assertEqual(owner, await seedSwap.owner());
        Helper.assertEqual(true, await seedSwap.isWhitelistAdmin(owner));
        // deployer is also an admin
        Helper.assertEqual(true, await seedSwap.isWhitelistAdmin(deployer));
        Helper.assertEqual(owner, await seedSwap.ethRecipient());
        Helper.assertEqual(false, await seedSwap.isPaused());
      });

      it(`Test deploy with deployer == owner`, async() => {
        seedSwap = await SeedSwap.new(owner, teaToken.address, { from: owner });
        Helper.assertEqual(owner, await seedSwap.owner());
        Helper.assertEqual(true, await seedSwap.isWhitelistAdmin(owner));
        Helper.assertEqual(owner, await seedSwap.ethRecipient());
      });

      it(`Test invalid constructor params`, async() => {
        await expectRevert(
          SeedSwap.new(owner, address0, { from: deployer }),
            "constructor: invalid token"
        );
      });
    });

    const delayToStartTime = async() => {
      // delay to start time
      let currentTime = await Helper.currentBlockTime();
      let duration = (await seedSwap.saleStartTime()) * 1 + 1 - currentTime;
      await Helper.delayChainTime(duration);
    }

    const delayToEndTime = async() => {
      // delay to start time
      let currentTime = await Helper.currentBlockTime();
      let duration = (await seedSwap.saleEndTime()) * 1 + 1 - currentTime;
      await Helper.delayChainTime(duration);
    }

    describe(`Test Invalid swaps`, async() => {
      beforeEach(`Init contracts for each test`, async() => {
        let currentTime = new BN(await Helper.currentBlockTime());
        seedSwap = await MockTestSeedSwap.new(
          owner,
          teaToken.address,
          currentTime.add(new BN(20)),  // start
          currentTime.add(new BN(60)), // end
          new BN(10).pow(new BN(16)),   // hard cap
          new BN(10).pow(new BN(18)),   // user's cap
          { from: deployer }
        );
        // add all users as whitelisted
        await seedSwap.updateWhitelistedUsers(accounts, true, { from: owner });
      });

      const expectRevertWithMessage = async function(user, amount, errorMessage) {
        await expectRevert(
          seedSwap.swapEthToToken({ from: user, value: amount }),
          errorMessage
        );
        await expectRevert(
          Helper.transferEth(user, seedSwap.address, amount),
          errorMessage
        );
      }

      it(`Test positive amount`, async() => {
        await expectRevertWithMessage(user, new BN(0), "onlyCanSwap: amount is 0");
      });

      it(`Test sale has not started`, async() => {
        await expectRevertWithMessage(user, ethAmount, "onlyCanSwap: not started yet");
      });

      it(`Test sale already ended`, async() => {
        let currentTime = await Helper.currentBlockTime();
        let duration = (await seedSwap.saleEndTime()) * 1 - currentTime;
        await Helper.delayChainTime(duration);
        await expectRevertWithMessage(user, ethAmount, "onlyCanSwap: already ended");
      });

      it(`Test hardcap reached`, async() => {
        await delayToStartTime();
        let hardCap = await seedSwap.HARD_CAP();
        await seedSwap.swapEthToToken({ value: hardCap, from: owner });
        await expectRevertWithMessage(owner, ethAmount, "onlyCanSwap: HARD_CAP reached");
      });

      it(`Test min/max user's cap`, async() => {
        await delayToStartTime();
        let minCap = await seedSwap.MIN_INDIVIDUAL_CAP();
        await expectRevertWithMessage(owner, minCap.sub(new BN(1)), "onlyCanSwap: eth amount must be within individual cap");
        let maxCap = await seedSwap.MAX_INDIVIDUAL_CAP();
        await expectRevertWithMessage(owner, maxCap.add(new BN(1)), "onlyCanSwap: eth amount must be within individual cap");
        // check total swap is more than user's max cap
        let currentTime = new BN(await Helper.currentBlockTime());
        seedSwap = await MockTestSeedSwap.new(
          owner,
          teaToken.address,
          currentTime.add(new BN(20)),  // start
          currentTime.add(new BN(60)), // end
          ethAmount.mul(new BN(2)),   // hard cap
          ethAmount,   // user's cap
          { from: deployer }
        );
        await seedSwap.updateWhitelistedUsers(accounts, true, { from: owner });
        await delayToStartTime();
        await seedSwap.swapEthToToken({ from: user, value: ethAmount });
        await expectRevertWithMessage(user, ethAmount, "capSwap: max individual cap reached");
        // other user still can swap
        await seedSwap.swapEthToToken({ from: owner, value: ethAmount });
      });

      it(`Test whitelisted sender`, async() => {
        await delayToStartTime();
        // remove user from whitelisted address
        await seedSwap.updateWhitelistedUsers([user], false, { from: owner });
        await expectRevertWithMessage(user, ethAmount, "onlyCanSwap: sender is not whitelisted");
      });

      it(`Test whitelisted sender`, async() => {
        await delayToStartTime();
        // remove user from whitelisted address
        await seedSwap.updateWhitelistedUsers([user], false, { from: owner });
        await expectRevertWithMessage(user, ethAmount, "onlyCanSwap: sender is not whitelisted");
      });

      it(`Test can buy token when hardcap reached`, async() => {
        let currentTime = new BN(await Helper.currentBlockTime());
        seedSwap = await MockTestSeedSwap.new(
          owner,
          teaToken.address,
          currentTime.add(new BN(20)),  // start
          currentTime.add(new BN(60)), // end
          ethAmount,   // hard cap
          ethAmount.mul(new BN(2)),   // user's cap
          { from: deployer }
        );
        await seedSwap.updateWhitelistedUsers(accounts, true, { from: owner });
        await delayToStartTime();
        let tokenAmount = ethAmount.mul((await seedSwap.saleRate())).mul(new BN(3)).div(new BN(2));
        await teaToken.transfer(seedSwap.address, tokenAmount, { from: owner });
        await seedSwap.swapEthToToken({ value: ethAmount.sub(new BN(1)), from: user });
        await seedSwap.swapEthToToken({ value: ethAmount, from: owner });
      });

      it(`Test pause`, async() => {
        await delayToStartTime();
        await seedSwap.pause({ from: owner });
        await expectRevertWithMessage(user, ethAmount, "paused");
      });
    });

    const generateUserObject = function(user) {
      return {
        tokenRecipient: user,
        eAmount: new BN(0),
        tAmount: new BN(0),
        dAmount: new BN(0),
        ids: []
      }
    }

    const checkSwapObjectEqual = function(first, second) {
      Helper.assertEqual(first.user, second.user);
      Helper.assertEqual(first.eAmount, second.eAmount);
      Helper.assertEqual(first.tAmount, second.tAmount);
      Helper.assertEqual(first.dAmount, second.dAmount);
      Helper.assertEqual(first.daysID, second.daysID);
    }

    const generateSwapObject = function(sender, eAmount, tAmount) {
      return {
        user: sender,
        eAmount: eAmount,
        tAmount: tAmount,
        dAmount: new BN(0),
        timestamp: new BN(0),
        daysID: new BN(0)
      }
    }

    const checkUserData = async function(sender, userData, swapObjects) {
      let data = await seedSwap.getUserSwapData(sender);
      Helper.assertEqual(userData.tokenRecipient, data.tokenRecipient);
      Helper.assertEqual(userData.eAmount, data.totalEthAmount);
      Helper.assertEqual(userData.tAmount, data.totalTokenAmount);
      Helper.assertEqual(userData.dAmount, data.distributedAmount);
      Helper.assertEqual(userData.tAmount.sub(userData.dAmount), data.remainingAmount);
      // check individual swap object
      Helper.assertEqual(userData.ids.length, data.ethAmounts.length);
      Helper.assertEqual(userData.ids.length, data.tokenAmounts.length);
      Helper.assertEqual(userData.ids.length, data.distributedAmounts.length);
      Helper.assertEqual(userData.ids.length, data.daysIDs.length);
      for(let j = 0; j < userData.ids.length; j++) {
        let object = swapObjects[userData.ids[j]];
        Helper.assertEqual(object.eAmount, data.ethAmounts[j]);
        Helper.assertEqual(object.tAmount, data.tokenAmounts[j]);
        Helper.assertEqual(object.dAmount, data.distributedAmounts[j]);
        Helper.assertEqual(object.daysID, data.daysIDs[j]);
      }
    }

    describe(`Test Swap, data changes correctly`, async() => {
      beforeEach(`Init contracts for each test`, async() => {
        let currentTime = new BN(await Helper.currentBlockTime());
        seedSwap = await MockTestSeedSwap.new(
          owner,
          teaToken.address,
          currentTime.add(new BN(20)),  // start
          currentTime.add(new BN(3000)), // end
          new BN(10).pow(new BN(18)),   // hard cap
          new BN(10).pow(new BN(18)),   // user's cap
          { from: deployer }
        );
        // add all users as whitelisted
        await seedSwap.updateWhitelistedUsers(accounts, true, { from: owner });
        await delayToStartTime();
        userData = {}
        currentEthSwapped = new BN(0);
        currentTokenSwapped = new BN(0);
      });

      it(`Test multiple swaps`, async() => {
        let numLoops = 50;
        let ethRecipient = await seedSwap.ethRecipient();
        let userMinCap = await seedSwap.MIN_INDIVIDUAL_CAP();
        let startTime = await seedSwap.saleStartTime();

        let gasUsed = new BN(0);
        let txCount = 0;

        for(let i = 0; i < numLoops; i++) {
          let ethAmount = userMinCap.add(new BN(Helper.getRandomNumer(0, 1000000000)));
          let expectedTokenAmount = ethAmount.mul(await seedSwap.saleRate());
          let userId;
          while (true) {
            // don't use eth recipient to swap
            userId = Helper.getRandomNumer(0, accounts.length - 1);
            if (accounts[userId] != ethRecipient) { break; }
          }
          let sender = accounts[userId];
          let tx;

          let balanceEthBefore = await Helper.getEthBalance(ethRecipient);
          if (Helper.getRandomNumer(0, 100) % 2 == 0) {
            tx = await seedSwap.swapEthToToken({ from: sender, value: ethAmount });
            txCount += 1;
            gasUsed.iadd(new BN(tx.receipt.gasUsed));
          } else {
            await Helper.transferEth(sender, seedSwap.address, ethAmount);
          }
          let balanceEthAfter = await Helper.getEthBalance(ethRecipient);

          /// update data
          currentEthSwapped.iadd(ethAmount);
          currentTokenSwapped.iadd(expectedTokenAmount);

          let swapObject = generateSwapObject(sender, ethAmount, expectedTokenAmount, 0);
          swapObject.timestamp = new BN(await Helper.currentBlockTime());
          swapObject.daysID = swapObject.timestamp.sub(startTime).div(await seedSwap.DISTRIBUTE_PERIOD_UNIT()) * 1;
          swapObjects.push(swapObject);
          if (userData[sender] == undefined) {
            userData[sender] = generateUserObject(sender);
          }
          userData[sender].eAmount.iadd(ethAmount);
          userData[sender].tAmount.iadd(expectedTokenAmount);
          userData[sender].ids.push(swapObjects.length - 1);

          /// verify data
          Helper.assertEqual(ethAmount, balanceEthAfter.sub(balanceEthBefore), "eth is not received correctly");
          let totalData = await seedSwap.totalData();
          Helper.assertEqual(currentEthSwapped, totalData.eAmount, "total eth is not recorded correctly");
          Helper.assertEqual(currentTokenSwapped, totalData.tAmount, "total token is not recorded correctly");
          Helper.assertEqual(new BN(0), await seedSwap.totalDistributedToken());
          Helper.assertEqual(swapObjects.length, await seedSwap.getNumberSwaps(), "number swaps is wrong");

          // check swap data
          let data = await seedSwap.listSwaps(swapObjects.length - 1);
          checkSwapObjectEqual(swapObject, data);
          // check user data
          checkUserData(sender, userData[sender], swapObjects);
        }
        if (txCount > 0) {
          console.log(`          Average gas used for ${numLoops}: ${gasUsed.div(new BN(txCount)).toString(10)}`);
        }
      });

      it(`Test swap after update sale rate`, async() => {
        let userMinCap = await seedSwap.MIN_INDIVIDUAL_CAP();
        let ethAmount = userMinCap.add(new BN(Helper.getRandomNumer(0, 1000000000)));
        let saleRate = await seedSwap.saleRate();
        let expectedTokenAmount = ethAmount.mul(saleRate);
        await seedSwap.swapEthToToken({ from: user, value: ethAmount });
        currentEthSwapped.iadd(ethAmount);
        currentTokenSwapped.iadd(expectedTokenAmount);

        for(let i = 0; i < 4; i++) {
          /// update sale rate
          saleRate = saleRate.add(new BN(Helper.getRandomNumer(0, saleRate / 2)));
          await seedSwap.updateSaleRate(saleRate, { from: owner });
          Helper.assertEqual(saleRate, await seedSwap.saleRate());

          expectedTokenAmount = ethAmount.mul(saleRate);
          await seedSwap.swapEthToToken({ from: user, value: ethAmount });

          currentEthSwapped.iadd(ethAmount);
          currentTokenSwapped.iadd(expectedTokenAmount);

          let totalData = await seedSwap.totalData();
          Helper.assertEqual(currentEthSwapped, totalData.eAmount, "total eth is not recorded correctly");
          Helper.assertEqual(currentTokenSwapped, totalData.tAmount, "total token is not recorded correctly");

          let numberObject = await seedSwap.getNumberSwaps();
          let data = await seedSwap.listSwaps(numberObject * 1 - 1);
          Helper.assertEqual(ethAmount, data.eAmount);
          Helper.assertEqual(expectedTokenAmount, data.tAmount);
          Helper.assertEqual(new BN(0), data.dAmount);
        }
      });

      it(`Test swap after update recipient`, async() => {
        let userMinCap = await seedSwap.MIN_INDIVIDUAL_CAP();
        let ethAmount = userMinCap.add(new BN(Helper.getRandomNumer(0, 1000000000)));

        for(let i = 0; i < 4; i++) {
          await seedSwap.updateEthRecipientAddress(accounts[i], { from: owner });

          let balanceBefore = await Helper.getEthBalance(accounts[i]);
          await seedSwap.swapEthToToken({ value: ethAmount, from: accounts[6] });
          let balanceAfter = await Helper.getEthBalance(accounts[i]);
          Helper.assertEqual(ethAmount, balanceAfter.sub(balanceBefore));
        }
      });
    });

    const makeSomeSwapsAndCheckData = async function(num) {
      Helper.assertEqual(0, await seedSwap.getNumberSwaps());
      let startTime = await seedSwap.saleStartTime();
      let userMinCap = await seedSwap.MIN_INDIVIDUAL_CAP();
      for(let id = 0; id < num; id++) {
        let ethAmount = userMinCap.add(new BN(Helper.getRandomNumer(0, 1000000000)));
        let expectedTokenAmount = ethAmount.mul(await seedSwap.saleRate());
        let userId = Helper.getRandomNumer(0, accounts.length - 1);
        let sender = accounts[userId];

        if (Helper.getRandomNumer(0, 100) % 2 == 0) {
          await seedSwap.swapEthToToken({ from: sender, value: ethAmount });
        } else {
          await Helper.transferEth(sender, seedSwap.address, ethAmount);
        }

        /// update data
        currentEthSwapped.iadd(ethAmount);
        currentTokenSwapped.iadd(expectedTokenAmount);

        let swapObject = generateSwapObject(sender, ethAmount, expectedTokenAmount, 0);
        swapObject.timestamp = new BN(await Helper.currentBlockTime());
        swapObject.daysID = swapObject.timestamp.sub(startTime).div(await seedSwap.DISTRIBUTE_PERIOD_UNIT()) * 1
        swapObjects.push(swapObject);
        if (userData[sender] == undefined) {
          userData[sender] = generateUserObject(sender);
        }
        userData[sender].eAmount.iadd(ethAmount);
        userData[sender].tAmount.iadd(expectedTokenAmount);
        userData[sender].ids.push(swapObjects.length - 1);
        // check data
        Helper.assertEqual(id + 1, await seedSwap.getNumberSwaps());
        // check new object swap
        checkSwapObjectEqual(swapObjects[id], await seedSwap.listSwaps(id));
      }
      // check all object swaps
      let allSwaps = await seedSwap.getAllSwaps();
      for(let i = 0; i < num; i++) {
        let object = generateSwapObject(
          allSwaps.users[i],
          allSwaps.ethAmounts[i],
          allSwaps.tokenAmounts[i]
        );
        object.dAmount = allSwaps.distributedAmounts[i];
        object.daysID = allSwaps.daysIDs[i];
        checkSwapObjectEqual(swapObjects[i], object);
      }

      for(let i = 0; i < accounts.length; i++) {
        if (Helper.getRandomNumer(0, 100) % 3 == 0) {
          let id = Helper.getRandomNumer(0, accounts.length - 1);
          await seedSwap.updateUserTokenRecipient(accounts[i], accounts[id], { from: owner });
          userData[accounts[i]].tokenRecipient = accounts[id];
        }
      }
    }

    const updateDataAfterDistributed = async function(percentage, id) {
      let amount = swapObjects[id].tAmount.mul(new BN(percentage)).div(new BN(100));
      swapObjects[id].dAmount = swapObjects[id].dAmount.add(amount);
      // check object and user's data have been updated correctly
      checkSwapObjectEqual(swapObjects[id], await seedSwap.listSwaps(id));
      let user = swapObjects[id].user;
      // add distributed amount to user, and user's token balance
      userData[user].dAmount = userData[user].dAmount.add(amount);
      let recipient = userData[user].tokenRecipient;
      if (recipient == address0) {
        recipient = user;
        userData[user].tokenRecipient = recipient;
      }
      userTokenBalances[recipient] = userTokenBalances[recipient].add(amount);
      return amount;
    }

    const deployAndInitData = async function() {
      let currentTime = new BN(await Helper.currentBlockTime());
      seedSwap = await MockTestSeedSwap.new(
        owner,
        teaToken.address,
        currentTime.add(new BN(20)),  // start
        currentTime.add(new BN(100)), // end
        new BN(10).pow(new BN(18)),   // hard cap
        new BN(10).pow(new BN(18)),   // user's cap
        { from: deployer }
      );
      // add all users as whitelisted admin and users
      await seedSwap.updateWhitelistedAdmins(accounts, true, { from: owner });
      await seedSwap.updateWhitelistedUsers(accounts, true, { from: owner });
      await delayToStartTime();
      userData = {}
      swapObjects = [];
      currentEthSwapped = new BN(0);
      currentTokenSwapped = new BN(0);
      totalDistributed = new BN(0);
      userTokenBalances = {};
      for(let i = 0; i < accounts.length; i++) {
        userTokenBalances[accounts[i]] = await teaToken.balanceOf(accounts[i]);
        userData[accounts[i]] = generateUserObject(accounts[i]);
      }
    }

    describe(`Test distribute`, async() => {
      beforeEach(`Init contracts for each test`, async() => {
        await deployAndInitData();
      });

      it(`Test distributeAll`, async() => {
        await makeSomeSwapsAndCheckData(40);
        await delayToEndTime();
        let totalTokens = (await seedSwap.totalData()).tAmount;
        await teaToken.transfer(seedSwap.address, totalTokens, { from: owner });
        userTokenBalances[owner] = userTokenBalances[owner].sub(totalTokens);
        totalDistributed = new BN(0);

        let numLoops = 5;
        for(let i = 0; i < numLoops; i++) {
          // make sure total percentage <= 100
          let percentage = Helper.getRandomNumer(1, Math.floor(100 / numLoops));
          let daysID = Helper.getRandomNumer(0, 2);
          let balanceBefore = await teaToken.balanceOf(seedSwap.address);
          await seedSwap.distributeAll(percentage, daysID, { from: admin });
          let balanceAfter = await teaToken.balanceOf(seedSwap.address);
          let distributedAmount = new BN(0);
          for(let j = 0; j < swapObjects.length; j++) {
            if (swapObjects[j].daysID == daysID) {
              let amount = await updateDataAfterDistributed(percentage, j);
              distributedAmount = distributedAmount.add(amount);
            }
          }
          totalDistributed = totalDistributed.add(distributedAmount);
          Helper.assertEqual(distributedAmount, balanceBefore.sub(balanceAfter));
          Helper.assertEqual(totalDistributed, await seedSwap.totalDistributedToken());
          for(let j = 0; j < accounts.length; j++) {
            // check user data
            checkUserData(accounts[j], userData[accounts[j]], swapObjects);
            // check token balance
            Helper.assertEqual(userTokenBalances[accounts[j]], await teaToken.balanceOf(accounts[j]));
          }
        }
      });

      it(`Test distributeBatch`, async() => {
        await makeSomeSwapsAndCheckData(40);
        await delayToEndTime();
        let totalTokens = (await seedSwap.totalData()).tAmount;
        await teaToken.transfer(seedSwap.address, totalTokens, { from: owner });
        userTokenBalances[owner] = userTokenBalances[owner].sub(totalTokens);
        totalDistributed = new BN(0);

        let numLoops = 5;
        for(let i = 0; i < numLoops; i++) {
          let percentage = Helper.getRandomNumer(1, Math.floor(100 / numLoops));
          // create random batches
          let batches = [];
          for(let j = 0; j < swapObjects.length; j++) {
            if (Helper.getRandomNumer(0, 100) % 2 == 0) {
              batches.push(j);
            }
          }
          let balanceBefore = await teaToken.balanceOf(seedSwap.address);
          await seedSwap.distributeBatch(percentage, batches, { from: admin });
          let balanceAfter = await teaToken.balanceOf(seedSwap.address);
          let distributedAmount = new BN(0);
          for(let j = 0; j < batches.length; j++) {
            let amount = await updateDataAfterDistributed(percentage, batches[j]);
            distributedAmount = distributedAmount.add(amount);
          }
          totalDistributed = totalDistributed.add(distributedAmount);
          Helper.assertEqual(distributedAmount, balanceBefore.sub(balanceAfter));
          Helper.assertEqual(totalDistributed, await seedSwap.totalDistributedToken());
          for(let j = 0; j < accounts.length; j++) {
            // check user data
            checkUserData(accounts[j], userData[accounts[j]], swapObjects);
            // check token balance
            Helper.assertEqual(userTokenBalances[accounts[j]], await teaToken.balanceOf(accounts[j]));
          }
        }
      });

      it(`Test user emergency withdraw tokens`, async() => {
        await makeSomeSwapsAndCheckData(40);

        await expectRevert(
          seedSwap.selfWithdrawToken({ from: owner }),
          "Emergency: not open for emergency withdrawal"
        );

        // delay to emergency withdraw time
        let time = (await seedSwap.saleEndTime()).add(await seedSwap.WITHDRAWAL_DEADLINE()).add(new BN(1));
        let currentTime = await Helper.currentBlockTime();
        await Helper.delayChainTime(time * 1 - currentTime);

        // not enough token balance for withdrawal
        let totalTokens = (await seedSwap.totalData()).tAmount;

        for(let i = 0; i < accounts.length; i++) {
          let sender = accounts[i];
          let uAmount = userData[sender].tAmount.sub(userData[sender].dAmount);
          if (uAmount.gt(new BN(0))) {
            await expectRevert(
              seedSwap.selfWithdrawToken({ from: sender }),
              "Emergency: not enough token to distribute"
            );
          }
        }

        // transfer enough token to distribute
        await teaToken.transfer(seedSwap.address, totalTokens, { from: owner });

        userTokenBalances[owner] = userTokenBalances[owner].sub(totalTokens);
        totalDistributed = new BN(0);

        for(let i = 0; i < accounts.length; i++) {
          let sender = accounts[i];
          let uAmount = userData[sender].tAmount.sub(userData[sender].dAmount);
          if (uAmount.gt(new BN(0))) {
            let balanceBefore = await teaToken.balanceOf(seedSwap.address);
            let userBefore = await teaToken.balanceOf(userData[sender].tokenRecipient);
            await seedSwap.selfWithdrawToken({ from: sender });
            userData[sender].dAmount = userData[sender].tAmount;
            for(let j = 0; j < userData[sender].ids.length; j++) {
              let id = userData[sender].ids[j];
              swapObjects[id].dAmount = swapObjects[id].tAmount;
              checkSwapObjectEqual(swapObjects[id], await seedSwap.listSwaps(id));
            }
            let balanceAfter = await teaToken.balanceOf(seedSwap.address);
            let userAfter = await teaToken.balanceOf(userData[sender].tokenRecipient);
            Helper.assertEqual(uAmount, balanceBefore.sub(balanceAfter));
            Helper.assertEqual(uAmount, userAfter.sub(userBefore));
            checkUserData(sender, userData[sender], swapObjects);
          } else {
            await expectRevert(
              seedSwap.selfWithdrawToken({ from: sender }),
              "Emergency: user has claimed all tokens"
            );
          }
        }
      });

      it(`Test distributeAll reverts`, async() => {
        await makeSomeSwapsAndCheckData(1);

        // check not admin
        await seedSwap.updateWhitelistedAdmins([user], false, { from: owner });
        await expectRevert(
          seedSwap.distributeAll(50, 0, { from: user }),
          "WhitelistAdminRole: caller does not have the WhitelistAdmin role"
        );

        // check revert not ended
        await expectRevert(
          seedSwap.distributeAll(50, 1000, { from: admin }),
          "not ended yet"
        );

        // delay to end time
        await delayToEndTime();

        // check revert when pause
        await seedSwap.pause({ from: admin });
        await expectRevert(
          seedSwap.distributeAll(50, 1000, { from: admin }),
          "paused"
        );

        // unpause
        await seedSwap.unpause({ from: admin });

        // check percentage is out of range (0 < percentage <= 100)
        await expectRevert(
          seedSwap.distributeAll(0, 1000, { from: admin }),
          "percentage out of range"
        );
        await expectRevert(
          seedSwap.distributeAll(101, 1000, { from: admin }),
          "percentage out of range"
        );

        // test not enough tea token
        // withdraw all tea token if any
        let teaBalance = await teaToken.balanceOf(seedSwap.address);
        if (teaBalance.gt(new BN(0))) {
          await seedSwap.emergencyOwnerWithdraw(teaToken.address, teaBalance, { from: owner });
        }
        await expectRevert(
          seedSwap.distributeAll(100, 0, { from: admin }),
          "Distribute: not enough token to distribute"
        );

        await teaToken.transfer(seedSwap.address, swapObjects[0].tAmount, { from: owner });
        await seedSwap.distributeAll(50, 0, { from: admin });
        // distribute more than 100^
        await expectRevert(
          seedSwap.distributeAll(51, 0, { from: admin }),
          "Distribute: total distribute more than 100%"
        );
        await seedSwap.distributeAll(50, 0, { from: admin });
      });

      it(`Test distributeBatch reverts`, async() => {
        await makeSomeSwapsAndCheckData(2);

        // check not admin
        await seedSwap.updateWhitelistedAdmins([user], false, { from: owner });
        await expectRevert(
          seedSwap.distributeBatch(50, [0], { from: user }),
          "WhitelistAdminRole: caller does not have the WhitelistAdmin role"
        );

        // check revert not ended
        await expectRevert(
          seedSwap.distributeBatch(50, [0], { from: admin }),
          "not ended yet"
        );

        // delay to end time
        await delayToEndTime();

        // check revert when pause
        await seedSwap.pause({ from: admin });
        await expectRevert(
          seedSwap.distributeBatch(50, [0], { from: admin }),
          "paused"
        );

        // unpause
        await seedSwap.unpause({ from: admin });

        // check percentage is out of range (0 < percentage <= 100)
        await expectRevert(
          seedSwap.distributeBatch(0, [0], { from: admin }),
          "percentage out of range"
        );
        await expectRevert(
          seedSwap.distributeBatch(101, [0], { from: admin }),
          "percentage out of range"
        );

        // test not enough tea token
        // withdraw all tea token if any
        let teaBalance = await teaToken.balanceOf(seedSwap.address);
        if (teaBalance.gt(new BN(0))) {
          await seedSwap.emergencyOwnerWithdraw(teaToken.address, teaBalance, { from: owner });
        }
        await expectRevert(
          seedSwap.distributeBatch(100, [0], { from: admin }),
          "Distribute: not enough token to distribute"
        );

        // transfer enough token to distribute
        await teaToken.transfer(
          seedSwap.address,
          swapObjects[0].tAmount.add(swapObjects[1].tAmount),
          { from: owner }
        );

        // check index out of range
        await expectRevert(
          seedSwap.distributeBatch(50, [2], { from: admin }),
          "Distribute: invalid id"
        );
        // check indices are not in order
        await expectRevert(
          seedSwap.distributeBatch(50, [1, 0], { from: admin }),
          "Distribute: indices are not in order"
        );
        await expectRevert(
          seedSwap.distributeBatch(50, [1, 1], { from: admin }),
          "Distribute: indices are not in order"
        );

        await seedSwap.distributeBatch(50, [0], { from: admin });
        // revert distribute more than 100%
        await expectRevert(
          seedSwap.distributeBatch(51, [0,1], { from: admin }),
          "Distribute: total distribute more than 100%"
        )
        await seedSwap.distributeBatch(51, [1], { from: admin });
        await seedSwap.distributeBatch(50, [0], { from: admin });
      });

      it(`Test max number swaps`, async() => {
        let currentTime = new BN(await Helper.currentBlockTime());
        seedSwap = await MockTestSeedSwap.new(
          owner,
          teaToken.address,
          currentTime.add(new BN(20)),  // start
          currentTime.add(new BN(1000)), // end
          new BN(10).pow(new BN(30)),   // hard cap
          new BN(10).pow(new BN(30)),   // user's cap
          { from: deployer }
        );
        // add all users as whitelisted admin and users
        await seedSwap.updateWhitelistedAdmins(accounts, true, { from: owner });
        await seedSwap.updateWhitelistedUsers(accounts, true, { from: owner });
        await delayToStartTime();

        let numLoops = 400;
        let safeNumbers = 150;
        let batches = [];
        for(let i = 0; i < numLoops; i++) {
          await seedSwap.swapEthToToken({
            value: new BN(10).pow(new BN(18)),
            from: accounts[i % accounts.length]
          });
        }
        for(let i = 0; i < safeNumbers; i++) {
          batches.push(i);
        }

        // test get all swaps
        let data = await seedSwap.getAllSwaps();
        Helper.assertEqual(data.users.length, numLoops);

        await delayToEndTime();
        // transfer enough token
        await teaToken.transfer(
          seedSwap.address,
          (await seedSwap.totalData()).tAmount,
          { from: owner }
        );
        // test distribute safeNumbers orders
        let tx = await seedSwap.distributeBatch(50, batches, { from: owner });
        console.log(`Distributed ${safeNumbers} orders, gas used: ${tx.receipt.gasUsed}`);
      });

      it(`Test distribute owner changes token recipient`, async() => {
        let ethAmount = await seedSwap.MIN_INDIVIDUAL_CAP();
        await seedSwap.swapEthToToken({ value: ethAmount, from: accounts[0] });

        await delayToEndTime();
        await expectRevert(
          seedSwap.updateUserTokenRecipient(accounts[0], accounts[3], { from: accounts[0] }),
          "Ownable: caller is not the owner"
        );
        await expectRevert(
          seedSwap.updateUserTokenRecipient(accounts[0], address0, { from: owner }),
          "invalid recipient"
        );
        await seedSwap.updateUserTokenRecipient(accounts[0], accounts[3], { from: owner });

        // transfer token to contract
        await teaToken.transfer(seedSwap.address, (await seedSwap.totalData()).tAmount, { from: owner });

        let balanceBefore = await teaToken.balanceOf(accounts[3]);
        let swapData = await seedSwap.listSwaps(0);
        await seedSwap.distributeAll(50, swapData.daysID, { from: admin });
        let expectedBalance = balanceBefore.add(swapData.tAmount.div(new BN(2)));
        Helper.assertEqual(expectedBalance, await teaToken.balanceOf(accounts[3]));

        balanceBefore = expectedBalance;
        await seedSwap.distributeBatch(50, [0], { from: admin });
        expectedBalance = balanceBefore.add(swapData.tAmount.div(new BN(2)));
        Helper.assertEqual(expectedBalance, await teaToken.balanceOf(accounts[3]));
      });

      it(`Test emergency withdraw owner changes token recipient`, async() => {
        let ethAmount = await seedSwap.MIN_INDIVIDUAL_CAP();
        await seedSwap.swapEthToToken({ value: ethAmount, from: accounts[0] });

        // delay to emergency withdraw time
        let time = (await seedSwap.saleEndTime()).add(await seedSwap.WITHDRAWAL_DEADLINE()).add(new BN(1));
        let currentTime = await Helper.currentBlockTime();
        await Helper.delayChainTime(time * 1 - currentTime);

        await seedSwap.updateUserTokenRecipient(accounts[0], accounts[3], { from: owner });
        // transfer token to contract
        await teaToken.transfer(seedSwap.address, (await seedSwap.totalData()).tAmount, { from: owner });

        let balanceBefore = await teaToken.balanceOf(accounts[3]);
        let swapData = await seedSwap.listSwaps(0);
        await seedSwap.selfWithdrawToken({ from: accounts[0] });
        let expectedBalance = balanceBefore.add(swapData.tAmount);
        Helper.assertEqual(expectedBalance, await teaToken.balanceOf(accounts[3]));
      });
    });

    describe(`Test estimate distributes`, async() => {
      before('init data and contracts', async () => {
        deployer = accounts[0];
        admin = accounts[1];
        owner = accounts[2];
        teaToken = await TeaToken.new(owner);
      });
  
      beforeEach(`Before each test`, async() => {
        await deployAndInitData();
      });
  
      const verifySelectedDistributeData = async function(
        estData, isSafe, totalUsers, totalAmount, ids, users, recipients, amounts
      ) {
        Helper.assertEqual(isSafe, estData.isSafe);
        Helper.assertEqual(totalUsers, estData.totalUsers);
        Helper.assertEqual(totalAmount, estData.totalDistributingAmount);
        Helper.assertEqualArray(ids, estData.selectedIds);
        Helper.assertEqualArray(users, estData.users);
        Helper.assertEqualArray(recipients, estData.recipients);
        Helper.assertEqualArray(amounts, estData.distributingAmounts);
      }

      it(`Test estimateDistributeAll`, async() => {
        let safeNumber = await seedSwap.SAFE_DISTRIBUTE_NUMBER();
        await makeSomeSwapsAndCheckData(safeNumber * 2);
        await delayToEndTime();
        let totalTokenAmount = (await seedSwap.totalData()).tAmount;
        await teaToken.transfer(seedSwap.address, totalTokenAmount, { from: owner });

        let numLoops = 10;
        for(let i = 0; i < numLoops; i++) {
          let percentage = Helper.getRandomNumer(1, Math.floor(100 / numLoops));
          let daysID = Helper.getRandomNumer(0, 10);
          let totalAmounts = new BN(0);
          let totalUsers = 0;
          let selectedIds = [];
          let selectedUsers = [];
          let selectedRecipients = [];
          let selectDAmounts = [];
          for(let j = 0; j < swapObjects.length; j++) {
            if (swapObjects[j].daysID != daysID) continue;
            amount = swapObjects[j].tAmount.mul(new BN(percentage)).div(new BN(100));
            if (amount.gt(new BN(0))) {
              totalUsers += 1;
              selectedIds.push(j);
              selectedUsers.push(swapObjects[j].user);
              selectedRecipients.push(userData[swapObjects[j].user].tokenRecipient);
              selectDAmounts.push(amount);
              totalAmounts = totalAmounts.add(amount);
            }
          }
          let estData = await seedSwap.estimateDistributedAllData(percentage, daysID);
          await verifySelectedDistributeData(
            estData,
            totalUsers <= safeNumber * 1,
            totalUsers,
            totalAmounts,
            selectedIds,
            selectedUsers,
            selectedRecipients,
            selectDAmounts
          );

          // random if should distribute
          if (Helper.getRandomNumer(0, 100) % 2 == 0) {
            // distribute and update user data + swap objects
            await seedSwap.distributeAll(percentage, daysID, { from: admin });
            for(let j = 0; j < swapObjects.length; j++) {
              if (swapObjects[j].daysID == daysID) {
                await updateDataAfterDistributed(percentage, j);
              }
            }
          }
        }
      });

      it(`Test estimateDistributeAll returns empty`, async() => {
        let numberSwaps = 10;
        await makeSomeSwapsAndCheckData(numberSwaps);
        await delayToEndTime();
        let totalTokenAmount = (await seedSwap.totalData()).tAmount;
        await teaToken.transfer(seedSwap.address, totalTokenAmount, { from: owner });

        for(let i = 0; i < numberSwaps; i++) {
          await seedSwap.distributeAll(100, i, { from: admin });
          let estData = await seedSwap.estimateDistributedAllData(100, i);
          await verifySelectedDistributeData(estData, true, 0, 0, [], [], [], []);
        }
      })
  
      it(`Test estimateDistributeAll reverts`, async() => {
        await makeSomeSwapsAndCheckData(10);

        // not ended
        await expectRevert(
          seedSwap.estimateDistributedAllData(50, 0),
          "not ended yet"
        );
  
        await delayToEndTime();
  
        // not pause
        await seedSwap.pause({ from: owner });
        await expectRevert(
          seedSwap.estimateDistributedAllData(50, 0),
          "paused"
        );
        await seedSwap.unpause({ from: owner });

        // invalid percentage
        await expectRevert(
          seedSwap.estimateDistributedAllData(0, 0),
          "percentage out of range"
        );
        await expectRevert(
          seedSwap.estimateDistributedAllData(101, 0),
          "percentage out of range"
        );
  
        // not enough token balance
        await expectRevert(
          seedSwap.estimateDistributedAllData(50, 0),
          "Estimate: not enough token balance"
        );

        await teaToken.transfer(seedSwap.address, (await seedSwap.totalData()).tAmount, { from: owner });

        for(let i = 0; i < swapObjects.length; i++) {
          let daysID = swapObjects[i].daysID;
          if (i > 0 && daysID == swapObjects[i - 1].daysID) continue;
          await seedSwap.distributeAll(50, daysID, { from: admin });
          await expectRevert(
            seedSwap.estimateDistributedAllData(51, daysID, { from: admin }),
            "Estimate: total distribute more than 100%"
          );
          // can call with 50
          await seedSwap.estimateDistributedAllData(50, daysID, { from: admin });
        }
      });
  
      it(`Test estimateDistributeBatch`, async() => {
        let safeNumber = await seedSwap.SAFE_DISTRIBUTE_NUMBER();
        await makeSomeSwapsAndCheckData(safeNumber * 2);
        await delayToEndTime();
        let totalTokenAmount = (await seedSwap.totalData()).tAmount;
        await teaToken.transfer(seedSwap.address, totalTokenAmount, { from: owner });

        let numLoops = 10;
        for(let i = 0; i < numLoops; i++) {
          let percentage = Helper.getRandomNumer(1, Math.floor(100 / numLoops));
          let batches = [];
          for(let j = 0; j < swapObjects.length; j++) {
            if (Helper.getRandomNumer(0, 100) % 2 == 0) {
              batches.push(j);
            }
          }
          let totalAmounts = new BN(0);
          let totalUsers = 0;
          let selectedIds = [];
          let selectedUsers = [];
          let selectedRecipients = [];
          let selectDAmounts = [];
          for(let jj = 0; jj < batches.length; jj++) {
            let j = batches[jj];
            amount = swapObjects[j].tAmount.mul(new BN(percentage)).div(new BN(100));
            if (amount.gt(new BN(0))) {
              totalUsers += 1;
              selectedIds.push(j);
              selectedUsers.push(swapObjects[j].user);
              selectedRecipients.push(userData[swapObjects[j].user].tokenRecipient);
              selectDAmounts.push(amount);
              totalAmounts = totalAmounts.add(amount);
            }
          }
          let estData = await seedSwap.estimateDistributedBatchData(percentage, batches);
          await verifySelectedDistributeData(
            estData,
            totalUsers <= safeNumber * 1,
            totalUsers,
            totalAmounts,
            selectedIds,
            selectedUsers,
            selectedRecipients,
            selectDAmounts
          );

          // random if should distribute
          if (Helper.getRandomNumer(0, 100) % 2 == 0) {
            // distribute and update user data + swap objects
            await seedSwap.distributeBatch(percentage, batches, { from: admin });
            for(let j = 0; j < batches.length; j++) {
              await updateDataAfterDistributed(percentage, batches[j]);
            }
          }
        }
      });

      it(`Test estimateDistributeBatch returns empty`, async() => {
        let numberSwaps = 10;
        await makeSomeSwapsAndCheckData(numberSwaps);
        await delayToEndTime();
        let totalTokenAmount = (await seedSwap.totalData()).tAmount;
        await teaToken.transfer(seedSwap.address, totalTokenAmount, { from: owner });
        let batches = [];
        for(let i = 0; i < swapObjects.length; i++) {
          batches.push(i);
        }
        await seedSwap.distributeBatch(100, batches, { from: admin });
        let estData = await seedSwap.estimateDistributedBatchData(100, batches);
        await verifySelectedDistributeData(estData, true, 0, 0, [], [], [], []);
      })
  
      it(`Test estimateDistributeBatch reverts`, async() => {
        await makeSomeSwapsAndCheckData(2);

        // check revert not ended
        await expectRevert(
          seedSwap.estimateDistributedBatchData(50, [0], { from: admin }),
          "not ended yet"
        );

        // delay to end time
        await delayToEndTime();

        // check revert when pause
        await seedSwap.pause({ from: admin });
        await expectRevert(
          seedSwap.estimateDistributedBatchData(50, [0], { from: admin }),
          "paused"
        );

        // unpause
        await seedSwap.unpause({ from: admin });

        // check percentage is out of range (0 < percentage <= 100)
        await expectRevert(
          seedSwap.estimateDistributedBatchData(0, [0], { from: admin }),
          "percentage out of range"
        );
        await expectRevert(
          seedSwap.estimateDistributedBatchData(101, [0], { from: admin }),
          "percentage out of range"
        );

        // test not enough tea token
        // withdraw all tea token if any
        let teaBalance = await teaToken.balanceOf(seedSwap.address);
        if (teaBalance.gt(new BN(0))) {
          await seedSwap.emergencyOwnerWithdraw(teaToken.address, teaBalance, { from: owner });
        }
        await expectRevert(
          seedSwap.estimateDistributedBatchData(100, [0], { from: admin }),
          "Estimate: not enough token balance"
        );

        // transfer enough token to distribute
        await teaToken.transfer(
          seedSwap.address,
          swapObjects[0].tAmount.add(swapObjects[1].tAmount),
          { from: owner }
        );

        // check index out of range
        await expectRevert(
          seedSwap.estimateDistributedBatchData(50, [2], { from: admin }),
          "Estimate: id out of range"
        );
        // check indices are not in order
        await expectRevert(
          seedSwap.estimateDistributedBatchData(50, [1, 0], { from: admin }),
          "Estimate: duplicated ids"
        );
        await expectRevert(
          seedSwap.estimateDistributedBatchData(50, [1, 1], { from: admin }),
          "Estimate: duplicated ids"
        );

        await seedSwap.distributeBatch(50, [0], { from: admin });
        await expectRevert(
          seedSwap.estimateDistributedBatchData(51, [0,1], { from: admin }),
          "Estimate: total distribute more than 100%"
        );
        await seedSwap.estimateDistributedAllData(50, [0], { from: admin });
        await seedSwap.estimateDistributedAllData(100, [1], { from: admin });
      });
    });
  });

  describe('Test update default values', async () => {
    let defaultSaleStart = new BN(1609729200);
    let defaultSaleEnd = new BN(1610384340);
    let defaultRate = new BN(25000);
    let defaultRecipient;
    before('init data and contracts', async () => {
      deployer = accounts[0];
      admin = accounts[1];
      owner = accounts[2];
      teaToken = await TeaToken.new(admin);
    });

    beforeEach(`Before each test`, async() => {
      seedSwap = await SeedSwap.new(owner, teaToken.address, { from: deployer });
      await seedSwap.updateWhitelistedAdmins([admin], true, { from: owner });
    });

    it(`Test update sale times`, async() => {
      Helper.assertEqual(defaultSaleStart, await seedSwap.saleStartTime());
      Helper.assertEqual(defaultSaleEnd, await seedSwap.saleEndTime());

      // can not update, not owner
      await expectRevert(
        seedSwap.updateSaleTimes(defaultSaleStart, defaultSaleEnd, { from: admin }),
        "Ownable: caller is not the owner"
      );
      // can not update start in the past
      let currentTime = new BN(await Helper.currentBlockTime());
      await expectRevert(
        seedSwap.updateSaleTimes(currentTime.sub(new BN(10)), defaultSaleEnd, { from: owner }),
        "Times: invalid start time"
      );
      // start >= end
      await expectRevert(
        seedSwap.updateSaleTimes(defaultSaleEnd, defaultSaleEnd, { from: owner }),
        "Times: invalid start and end time"
      );
      // update with event, data changes
      currentTime = new BN(await Helper.currentBlockTime());
      let newStartTime = currentTime.add(new BN(100));
      let newEndTime = currentTime.add(new BN(1000));
      let tx = await seedSwap.updateSaleTimes(newStartTime, newEndTime, { from: owner });
      expectEvent(tx, "UpdateSaleTimes", {
        newStartTime: newStartTime,
        newEndTime: newEndTime
      });
      Helper.assertEqual(newStartTime, await seedSwap.saleStartTime());
      Helper.assertEqual(newEndTime, await seedSwap.saleEndTime());

      // update sale time start is 0
      currentTime = new BN(await Helper.currentBlockTime());
      newEndTime = currentTime.add(new BN(200));
      await seedSwap.updateSaleTimes(new BN(0), newEndTime, { from: owner });
      Helper.assertEqual(newStartTime, await seedSwap.saleStartTime());
      Helper.assertEqual(newEndTime, await seedSwap.saleEndTime());

      // update sale time end is 0
      currentTime = new BN(await Helper.currentBlockTime());
      newStartTime = currentTime.add(new BN(50));
      await seedSwap.updateSaleTimes(newStartTime, new BN(0), { from: owner });
      Helper.assertEqual(newStartTime, await seedSwap.saleStartTime());
      Helper.assertEqual(newEndTime, await seedSwap.saleEndTime());

      // delay to start time
      await Helper.delayChainTime(100);
      // check can not update after started
      await expectRevert(
        seedSwap.updateSaleTimes(defaultSaleStart, defaultSaleEnd, { from: owner }),
        "already started"
      );
    });

    it(`Test update sale rate`, async() => {
      Helper.assertEqual(defaultRate, await seedSwap.saleRate());

      // can not update, not owner
      await expectRevert(
        seedSwap.updateSaleRate(defaultRate, { from: admin }),
        "Ownable: caller is not the owner"
      );
      // check can not update with low rate
      let newRate = defaultRate.div(new BN(2)).sub(new BN(1));
      await expectRevert(
        seedSwap.updateSaleRate(newRate, { from : owner }),
        "Rates: new rate too low"
      );
      // check can not update with high rate
      newRate = defaultRate.mul(new BN(3)).div(new BN(2)).add(new BN(1));
      await expectRevert(
        seedSwap.updateSaleRate(newRate, { from : owner }),
        "Rates: new rate too high"
      );
      // new rate is higher than max uint80 / max individual cap
      let maxCap = await seedSwap.MAX_INDIVIDUAL_CAP();
      let maxUint80 = (new BN(2).pow(new BN(79))).sub(new BN(1));
      newRate = maxUint80.div(maxCap).add(new BN(1))
      await expectRevert(
        seedSwap.updateSaleRate(newRate, { from : owner }),
        "Rates: new rate is out of range"
      );
      // update with lower rate, check event & data changes
      newRate = defaultRate.div(new BN(2));
      let tx = await seedSwap.updateSaleRate(newRate, { from: owner });
      expectEvent(tx, "UpdateSaleRate", {
        newSaleRate: newRate
      });
      Helper.assertEqual(newRate, await seedSwap.saleRate());
      // update with higher rate, check data changes
      newRate = newRate.mul(new BN(3)).div(new BN(2));
      await seedSwap.updateSaleRate(newRate, { from: owner });
      Helper.assertEqual(newRate, await seedSwap.saleRate());
      // update sale times, then check can not update rate after ended
      currentTime = new BN(await Helper.currentBlockTime());
      let newStartTime = currentTime.add(new BN(20));
      let newEndTime = currentTime.add(new BN(30));
      await seedSwap.updateSaleTimes(newStartTime, newEndTime, { from: owner });
      // delay to end time
      await Helper.delayChainTime(100);
      await expectRevert(
        seedSwap.updateSaleRate(newRate, { from: owner }),
        "already ended"
      );
    });

    it(`Test update recipient`, async() => {
      defaultRecipient = owner;
      Helper.assertEqual(defaultRecipient, await seedSwap.ethRecipient());

      // can not update, not owner
      await expectRevert(
        seedSwap.updateEthRecipientAddress(defaultRecipient, { from: admin }),
        "Ownable: caller is not the owner"
      );
      // check can not update with zero address
      await expectRevert(
        seedSwap.updateEthRecipientAddress(address0, { from : owner }),
        "Receipient: invalid eth recipient address"
      );
      let newRecipient = accounts[6];
      let tx = await seedSwap.updateEthRecipientAddress(newRecipient, { from: owner });
      expectEvent(tx, "UpdateEthRecipient", {
        newRecipient: newRecipient
      });
      Helper.assertEqual(newRecipient, await seedSwap.ethRecipient());
    });
  });

  describe('Tests ownership, whitelist contract, pause, add/remove whitelists', async () => {
    before('init data and contracts', async () => {
      deployer = accounts[0];
      admin = accounts[1];
      owner = accounts[2];
      user = accounts[3];
      teaToken = await TeaToken.new(owner);
      seedSwap = await SeedSwap.new(owner, teaToken.address, { from: deployer });
    });

    it(`Test pause`, async() => {
      Helper.assertEqual(false, await seedSwap.isPaused());
      // check only whitelist admin can pause
      await expectRevert(
        seedSwap.pause({ from: user}),
        "WhitelistAdminRole: caller does not have the WhitelistAdmin role"
      );
      // check only can unpause when paused
      await expectRevert(
        seedSwap.unpause({ from: owner}),
        "not paused"
      );
      // set pause to true
      await seedSwap.pause({ from: owner });
      // only can unpause by admin
      await expectRevert(
        seedSwap.unpause({ from: user}),
        "WhitelistAdminRole: caller does not have the WhitelistAdmin role"
      );
      // only can pause when it's unpaused
      await expectRevert(
        seedSwap.pause({ from: owner}),
        "paused"
      );
      // set back to unpaused
      await seedSwap.unpause({ from: owner });
    });

    it(`Test whitelist admin`, async() => {
      // only owner can add/remove
      await expectRevert(
        seedSwap.updateWhitelistedAdmins(
          [admin],
          true,
          { from: user }
        ),
        "Ownable: caller is not the owner"
      );
      await expectRevert(
        seedSwap.updateWhitelistedAdmins(
          [admin],
          false,
          { from: user }
        ),
        "Ownable: caller is not the owner"
      );
      // remove first if already an admin
      await seedSwap.updateWhitelistedAdmins([admin], false, { from: owner });
      // add new admin and check data is update
      await seedSwap.updateWhitelistedAdmins([admin], true, { from: owner });
      Helper.assertEqual(true, await seedSwap.isWhitelistAdmin(admin));
      // tx won't revert if add again
      await seedSwap.updateWhitelistedAdmins([admin], true, { from: owner });
      Helper.assertEqual(true, await seedSwap.isWhitelistAdmin(admin));
      // remove admin and check data
      await seedSwap.updateWhitelistedAdmins([admin], false, { from: owner });
      Helper.assertEqual(false, await seedSwap.isWhitelistAdmin(admin));
      // tx won't revert if remove again
      await seedSwap.updateWhitelistedAdmins([admin, deployer], false, { from: owner });
      Helper.assertEqual(false, await seedSwap.isWhitelistAdmin(admin));
    });

    it(`Test whitelist users`, async() => {
      // add admin if needed
      if (await seedSwap.isWhitelistAdmin(admin) == false) {
        await seedSwap.updateWhitelistedAdmins([admin], true, { from: owner });
      }
      // only admin can add/remove
      await expectRevert(
        seedSwap.updateWhitelistedUsers(
          [user],
          true,
          { from: user }
        ),
        "WhitelistAdminRole: caller does not have the WhitelistAdmin role"
      );
      await expectRevert(
        seedSwap.updateWhitelistedUsers(
          [user],
          false,
          { from: user }
        ),
        "WhitelistAdminRole: caller does not have the WhitelistAdmin role"
      );
      // remove first if already whitelisted
      await seedSwap.updateWhitelistedUsers([user], false, { from: admin });
      // add new whitelisted user and check data is update
      await seedSwap.updateWhitelistedUsers([user], true, { from: admin });
      Helper.assertEqual(true, await seedSwap.isWhitelisted(user));
      // tx won't revert if add again
      await seedSwap.updateWhitelistedUsers([user], true, { from: admin });
      // remove user and check data
      await seedSwap.updateWhitelistedUsers([user], false, { from: admin });
      Helper.assertEqual(false, await seedSwap.isWhitelisted(user));
      // tx won't revert if remove again
      await seedSwap.updateWhitelistedUsers([user, deployer], false, { from: admin });
      Helper.assertEqual(false, await seedSwap.isWhitelisted(user));
    });

    // no way to transfer eth to contract without reverting
    it(`Test owner withdraw token`, async() => {
      let tokenAmount = new BN(10).pow(new BN(10));
      await teaToken.transfer(seedSwap.address, tokenAmount, { from: owner });
      ownerBal = await teaToken.balanceOf(owner);
      await expectRevert(
        seedSwap.emergencyOwnerWithdraw(teaToken.address, tokenAmount, { from: user }),
        "Ownable: caller is not the owner"
      );
      await seedSwap.emergencyOwnerWithdraw(teaToken.address, tokenAmount, { from: owner, gasPrice: new BN(0) });
      newOwnerBal = await teaToken.balanceOf(owner);
      Helper.assertEqual(tokenAmount, newOwnerBal.sub(ownerBal));
      // call withdraw eth even though there is no way to transfer eth to that contract
      await expectRevert(
        seedSwap.emergencyOwnerWithdraw(ethAddress, tokenAmount, { from: user }),
        "Ownable: caller is not the owner"
      );
      let balanceOwner = await Helper.getEthBalance(owner);
      let balanceContract = await Helper.getEthBalance(seedSwap.address);
      await seedSwap.emergencyOwnerWithdraw(ethAddress, balanceContract, { from: owner, gasPrice: new BN(0) });
      Helper.assertEqual(balanceOwner.add(balanceContract), await Helper.getEthBalance(owner));
      Helper.assertEqual(0, await Helper.getEthBalance(seedSwap.address));
    });
  });
});
