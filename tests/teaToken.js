const TeaToken = artifacts.require('TeaToken.sol');

const BN = web3.utils.BN;

const Helper = require('./helper');

const totalSupply = new BN(200).mul(new BN(10).pow(new BN(24))); // 200M tokens
const tokenName = "TEA Token";
const tokenSymbol = "TEA";
const tokenDecimals = 18;

let teaToken;
let admin;
let user;

contract('TeaToken', accounts => {
  describe('test some simple trades', async () => {
    before('test trade in uniswap curve', async () => {
      user = accounts[0];
      admin = accounts[1];
      teaToken = await TeaToken.new(admin);
    });

    it(`Test data correct after deployed`, async() => {
      Helper.assertEqual(totalSupply, await teaToken.totalSupply(), "wrg total supply");
      Helper.assertEqual(tokenName, await teaToken.name(), "wrg token name");
      Helper.assertEqual(tokenSymbol, await teaToken.symbol(), "wrg token symbol");
      Helper.assertEqual(tokenDecimals, await teaToken.decimals(), "wrg token decimals");

      Helper.assertEqual(
        totalSupply,
        await teaToken.balanceOf(admin),
        "wrg admin balance"
      );
    });

    it(`Test burn`, async() => {
      let adminBal = await teaToken.balanceOf(admin);
      let burntAmount = new BN(10).pow(new BN(19));
      let totalSupply = await teaToken.totalSupply();
      await teaToken.burn(burntAmount, { from: admin });
      let newAdminBal = adminBal.sub(burntAmount);
      let newTotalSupply = totalSupply.sub(burntAmount);
      Helper.assertEqual(newAdminBal, await teaToken.balanceOf(admin));
      Helper.assertEqual(newTotalSupply, await teaToken.totalSupply());
    });

    it(`Test burnFrom`, async() => {
      let adminBal = await teaToken.balanceOf(admin);
      let userBal = await teaToken.balanceOf(user);
      let totalSupply = await teaToken.totalSupply();
      let burntAmount = new BN(10).pow(new BN(19));
      await teaToken.approve(user, burntAmount, { from: admin });
      await teaToken.burnFrom(admin, burntAmount, { from: user });
      let newAdminBal = adminBal.sub(burntAmount);
      let newTotalSupply = totalSupply.sub(burntAmount);
      Helper.assertEqual(newAdminBal, await teaToken.balanceOf(admin));
      Helper.assertEqual(newTotalSupply, await teaToken.totalSupply());
      // user's balance is not changed
      Helper.assertEqual(userBal, await teaToken.balanceOf(user));
    });
  });
});
