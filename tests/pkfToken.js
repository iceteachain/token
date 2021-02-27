const PkfToken = artifacts.require('PkfToken.sol');

const BN = web3.utils.BN;

const Helper = require('./helper');

const totalSupply = new BN(200).mul(new BN(10).pow(new BN(24))); // 200M tokens
const tokenName = "PolkaFoundry";
const tokenSymbol = "PKF";
const tokenDecimals = 18;

let pkfToken;
let admin;
let user;

contract('PkfToken', accounts => {
  describe('test some simple trades', async () => {
    before('test trade in uniswap curve', async () => {
      user = accounts[0];
      admin = accounts[1];
      pkfToken = await PkfToken.new(admin);
    });

    it(`Test data correct after deployed`, async() => {
      Helper.assertEqual(totalSupply, await pkfToken.totalSupply(), "wrg total supply");
      Helper.assertEqual(tokenName, await pkfToken.name(), "wrg token name");
      Helper.assertEqual(tokenSymbol, await pkfToken.symbol(), "wrg token symbol");
      Helper.assertEqual(tokenDecimals, await pkfToken.decimals(), "wrg token decimals");

      Helper.assertEqual(
        totalSupply,
        await pkfToken.balanceOf(admin),
        "wrg admin balance"
      );
    });

    it(`Test burn`, async() => {
      let adminBal = await pkfToken.balanceOf(admin);
      let burntAmount = new BN(10).pow(new BN(19));
      let totalSupply = await pkfToken.totalSupply();
      await pkfToken.burn(burntAmount, { from: admin });
      let newAdminBal = adminBal.sub(burntAmount);
      let newTotalSupply = totalSupply.sub(burntAmount);
      Helper.assertEqual(newAdminBal, await pkfToken.balanceOf(admin));
      Helper.assertEqual(newTotalSupply, await pkfToken.totalSupply());
    });

    it(`Test burnFrom`, async() => {
      let adminBal = await pkfToken.balanceOf(admin);
      let userBal = await pkfToken.balanceOf(user);
      let totalSupply = await pkfToken.totalSupply();
      let burntAmount = new BN(10).pow(new BN(19));
      await pkfToken.approve(user, burntAmount, { from: admin });
      await pkfToken.burnFrom(admin, burntAmount, { from: user });
      let newAdminBal = adminBal.sub(burntAmount);
      let newTotalSupply = totalSupply.sub(burntAmount);
      Helper.assertEqual(newAdminBal, await pkfToken.balanceOf(admin));
      Helper.assertEqual(newTotalSupply, await pkfToken.totalSupply());
      // user's balance is not changed
      Helper.assertEqual(userBal, await pkfToken.balanceOf(user));
    });
  });
});
