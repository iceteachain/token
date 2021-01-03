const Math = require('mathjs');
const BN = web3.utils.BN;
const { constants } = require('@openzeppelin/test-helpers');
require("chai")
    .use(require("chai-as-promised"))
    .use(require("chai-bn")(BN))
    .should();

const ethUnit = (new BN(10).pow(new BN(18)));
const ethDecimals = new BN(18);
const ethAddress = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const address0 = constants.ZERO_ADDRESS;
module.exports = { ethUnit, ethDecimals, ethAddress, address0 };


module.exports.transferEth = function( sender, recv, amount ) {
    return new Promise(function(fulfill, reject){
        web3.eth.sendTransaction({to: recv, from: sender, value: amount}, function(error, result) {
            if (error) {
                return reject(error);
            } else {
                return fulfill(true);
            }
        });
    });
};

module.exports.getEthBalance = function(account) {
    return new Promise(function (fulfill, reject){
        web3.eth.getBalance(account,function(err,result){
            if( err ) reject(err);
            else fulfill(new BN(result));
        });
    });
};

module.exports.currentBlockTime = function() {
    return new Promise(function (fulfill, reject){
        web3.eth.getBlock("latest", false, function(err,result){
            if( err ) reject(err);
            else fulfill(result.timestamp);
        });
    });
}

function assertEqual(val1, val2, errorStr) {
    assert(new BN(val1).should.be.a.bignumber.that.equals(new BN(val2)), errorStr);
}

module.exports.assertEqual = assertEqual;

module.exports.assertEqualArray = function (arr1, arr2, errorStr) {
    assertEqual(arr1.length, arr2.length, errorStr);
    for(let i = 0; i < arr1.length; i++) {
        assertEqual(arr1[i], arr2[i], errorStr);
    }
}

module.exports.assertGreater = function(val1, val2, errorStr) {
    assert(new BN(val1).should.be.a.bignumber.that.is.greaterThan(new BN(val2)), errorStr);
}

module.exports.assertLesser = function(val1, val2, errorStr) {
    assert(new BN(val1).should.be.a.bignumber.that.is.lessThan(new BN(val2)), errorStr);
}

module.exports.getRandomNumer = function (min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports.newBlockAt = async function(timestamp) {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send.bind(web3.currentProvider)(
      {
        jsonrpc: "2.0",
        method: "evm_mine",
        params: [timestamp],
        id: new Date().getTime(),
      }, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      },
    );
  });
}

module.exports.delayChainTime = async function(duration) {
  timeNow = await module.exports.currentBlockTime();
  return new Promise((resolve, reject) => {
    web3.currentProvider.send.bind(web3.currentProvider)(
      {
        jsonrpc: "2.0",
        method: "evm_mine",
        params: [
          timeNow + duration
        ],
        id: new Date().getTime(),
      }, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      },
    );
  });
}
