const artifacts = require('hardhat').artifacts
const BN = web3.utils.BN;

const PkfToken = artifacts.require('PkfToken.sol');

let token;
let tokenAddress;// = '0xb95fa86b07475ba55c0719085d5cae91c2af48cb';

let deployer;

async function main() {
  const accounts = await web3.eth.getAccounts();
  deployer = accounts[0];
  console.log(`Deployer address at ${deployer}`);

  gasPrice = new BN(2).mul(new BN(10).pow(new BN(9)));
  console.log(`Sending transactions with gas price: ${gasPrice.toString(10)} (${gasPrice.div(new BN(10).pow(new BN(9))).toString(10)} gweis)`);

  if (tokenAddress == undefined) {
    token = await PkfToken.new(deployer);
    tokenAddress = token.address;
    console.log(`Deployed pkf token at ${tokenAddress}`);
  } else {
    token = await PkfToken.at(tokenAddress);
    console.log(`Interacting pkf token at ${tokenAddress}`);
  }

  console.log(`PKF token balance: ${(await token.balanceOf(deployer)).toString(10)}`);

  await token.burn(new BN(10).pow(new BN(18)));
  console.log(`PKF token balance: ${(await token.balanceOf(deployer)).toString(10)}`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
