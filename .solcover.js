module.exports = {
  mocha: {
    timeout: 200000
  },
  providerOptions: {
    default_balance_ether: 10000000000000000000000,
    total_accounts: 20,
  },
  skipFiles: ['mock/', 'token/'],
  istanbulReporter: ['html', 'json']
};
