const artifacts = require('hardhat').artifacts
const BN = web3.utils.BN;

const TeaToken = artifacts.require('TeaToken.sol');
const SeedSwap = artifacts.require('SeedSwap.sol');

const Helper = require('../tests/helper');

let token;
let tokenAddress = "0x67362c384ed5724F79CB37218A2063B9A511Bc40";// = '0xb95fa86b07475ba55c0719085d5cae91c2af48cb';
let seedSwap;
let seedSwapAddress = "0xC4Dd0fE47e70B6F3CC4130c7a9b56116375a7246"; // = "0xdB3C74A0b900D55e328FF34663cC924a7BfA3988";

let deployer;

async function main() {
  const accounts = await web3.eth.getAccounts();
  deployer = accounts[0];
  console.log(`Deployer address at ${deployer}`);

  gasPrice = new BN(2).mul(new BN(10).pow(new BN(9)));
  console.log(`Sending transactions with gas price: ${gasPrice.toString(10)} (${gasPrice.div(new BN(10).pow(new BN(9))).toString(10)} gweis)`);

  if (tokenAddress == undefined) {
    token = await TeaToken.new(deployer, { gasPrice: gasPrice });
    tokenAddress = token.address;
    console.log(`Deployed tea token at ${tokenAddress}`);
  } else {
    token = await TeaToken.at(tokenAddress);
    console.log(`Interacting tea token at ${tokenAddress}`);
  }

  if (seedSwapAddress == undefined) {
    seedSwap = await SeedSwap.new(deployer, token.address, { gasPrice: gasPrice });
    seedSwapAddress = seedSwap.address;
    console.log(`Deployed seed swap at ${seedSwapAddress}`);
  } else {
    seedSwap = await SeedSwap.at(seedSwapAddress);
    console.log(`Interacting seed swap at ${seedSwapAddress}`);
  }

  // let tokenAmount = (await seedSwap.HARD_CAP()).mul((await seedSwap.saleRate())).mul(new BN(2));
  // await token.transfer(seedSwap.address, tokenAmount, { gasPrice: gasPrice });
  // console.log(`Transferred token to crowdsale`);

  // let addresses = [
  //   deployer,
  //   "0xc783df8a850f42e7f7e57013759c285caa701eb6",
  //   "0xead9c93b79ae7c1591b1fb5323bd777e86e150d4",
  // ];
  // await seedSwap.updateWhitelistedAdmins(addresses, true, { from: deployer, gasPrice: gasPrice });
  // await seedSwap.updateWhitelistedUsers(addresses, true, { from: deployer, gasPrice: gasPrice });

  // await seedSwap.swapEthToToken({ value: new BN(10).pow(new BN(16)), gasPrice: gasPrice });
  // await Helper.transferEth(deployer, seedSwapAddress, new BN(10).pow(new BN(16)));
  // await Helper.transferEth(deployer, "0xc783df8a850f42e7f7e57013759c285caa701eb6", (new BN(5)).mul(new BN(10).pow(new BN(17))));
  // await Helper.transferEth(deployer, "0xead9c93b79ae7c1591b1fb5323bd777e86e150d4", (new BN(5)).mul(new BN(10).pow(new BN(17))));

  const ethAmount = new BN(6).mul(new BN(10).pow(new BN(16)));
  let tx = await seedSwap.swapEthToToken({ value: ethAmount, gasPrice: gasPrice });
  console.log(`Swapped, gas used: ${tx.receipt.gasUsed}`);
  let data = await seedSwap.getUserSwapData(deployer);
  console.log(`eth: ${data.totalEthAmount}`);
  console.log(`token: ${data.totalTokenAmount}`);
  console.log(`dToken: ${data.distributedAmount}`);
  console.log(`uToken: ${data.remainingAmount}`);
  await Helper.transferEth(deployer, seedSwap.address, ethAmount, { gasPrice: gasPrice });

  data = await seedSwap.getUserSwapData(deployer);
  console.log(`eth: ${data.totalEthAmount}`);
  console.log(`token: ${data.totalTokenAmount}`);
  console.log(`dToken: ${data.distributedAmount}`);
  console.log(`uToken: ${data.remainingAmount}`);

  // tx = await seedSwap.distributeAll(100, 0, { gasPrice: gasPrice });
  // console.log(`distributed all, gas used: ${tx.receipt.gasUsed}`);
  // tx = await seedSwap.distributeBatch(100, [0], { gasPrice: gasPrice });
  // console.log(`distributed all, gas used: ${tx.receipt.gasUsed}`);
  // tx = await seedSwap.distributeBatch(100, [1], { gasPrice: gasPrice });
  // console.log(`distributed all, gas used: ${tx.receipt.gasUsed}`);
  // tx = await seedSwap.distributeBatch(100, [0, 1], { gasPrice: gasPrice });
  // console.log(`distributed all, gas used: ${tx.receipt.gasUsed}`);
  // console.log(await seedSwap.getUserSwapData(deployer));
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
