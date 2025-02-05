import CryptoJS from 'crypto-js'
import request from 'request-promise-native'
import qs from 'qs'
import algorithms from './algorithms'

var log = function log() {
  return console.log(...arguments);
}; // Fixed this for you, but you reall dont' need it. 


//const convertIDtoAlgo = algo => algo.toUpperCase();

function createNonce() {
  var s = '',
      length = 32;

  do {
    s += Math.random().toString(36).substr(2);
  } while (s.length < length);

  s = s.substr(0, length);
  return s;
}

const getAuthHeader = (apiKey, apiSecret, time, nonce, organizationId = '', request = {}) => {
  const hmac = CryptoJS.algo.HMAC.create(CryptoJS.algo.SHA256, apiSecret)
  hmac.update(apiKey)
  hmac.update('\0')
  hmac.update(time)
  hmac.update('\0')
  hmac.update(nonce)
  hmac.update('\0')
  hmac.update('\0')
  if (organizationId) hmac.update(organizationId)
  hmac.update('\0')
  hmac.update('\0')
  hmac.update(request.method)
  hmac.update('\0')
  hmac.update(request.path)
  hmac.update('\0')
  if (request.query)
      hmac.update(
          typeof request.query == 'object'
              ? qs.stringify(request.query)
              : request.query
      )
  if (request.body) {
      hmac.update('\0')
      hmac.update(
          typeof request.body == 'object'
              ? JSON.stringify(request.body)
              : request.body
      )
  }

  return apiKey + ':' + hmac.finalize().toString(CryptoJS.enc.Hex)
}

class NiceHash {
  constructor(settings = {}) {
      let { api_host, locale, api_key, api_secret, api_id } = settings
      this.locale = locale || 'en'
      this.host = api_host || 'https://api2.nicehash.com';
      this.key = api_key
      this.secret = api_secret
      this.org = api_id
      this.localTimeDiff = null
  }

  async getTime() {
      const res = await request({
          uri: this.host + '/api/v2/time',
          json: true,
      })
      this.localTimeDiff = res.serverTime - +new Date()
      this.time = res.serverTime
      return res
  }

  async apiCall(method, path, { query, body, time } = {}) {
      if (this.localTimeDiff === null) {
          return Promise.reject(new Error('Get server time first .getTime()'))
      }

      // query in path
      var [pathOnly, pathQuery] = path.split('?')
      if (pathQuery) query = { ...qs.parse(pathQuery), ...query }

      const nonce = createNonce();
      const timestamp = (time || +new Date() + this.localTimeDiff).toString()
      const options = {
          uri: this.host + pathOnly,
          method: method,
          headers: {
              'User-Agent': 'Request-Promise',
              // 'X-Requested-With': 'XMLHttpRequest',
              // 'Access-Control-Allow-Origin': '*',
              // 'X-User-Lang': this.locale,
              'X-Time': timestamp,
              'X-Nonce': nonce,
              'X-Organization-Id': this.org,
              'X-Request-Id': nonce,
              'X-Auth': getAuthHeader(
                  this.key,
                  this.secret,
                  timestamp,
                  nonce,
                  this.org,
                  {
                      method,
                      path: pathOnly,
                      query,
                      body,
                  }
              ),
          },
          qs: query,
          body,
          json: true,
      }

      return await request(options)
  }

  get(path, options) {
      return this.apiCall('GET', path, options)
  }

  post(path, options) {
      return this.apiCall('POST', path, options)
  }

  put(path, options) {
      return this.apiCall('PUT', path, options)
  }

  delete(path, options) {
      return this.apiCall('DELETE', path, options)
  }

  /* ----------------------- TEST-------------------------------------- */

  async testAuthorization() {
      if (this.key && this.org && this.secret) {
          try {
              let res = await this.getTime()
              log('Good to go 200', res)
              return !!res
          } catch (e) {
              throw new Error(`Test Authorization request failed: ${err}`)
          }
      } else {
          log('Check credentials')
          return false
      }
  }

  /* ----------------------- PUBLIC API -------------------------------------- */

  async getCurrentGlobalStats() {
      this.getTime()
          .then(() => this.get('/main/api/v2/public/stats/global/current'))
          .then(res => {
              if (res.algos) {
                  for (let stat of res.algos) {
                      stat.algo = algorithms[stat.a]
                  }
                  return res.algos
              }
          })
          .catch(err => {
              throw new Error(`Failed to get current global stats: ${err}`)
          })
  }

  /**
   * Get average profitability (price) and hashing speed for all algorithms in past 24 hours.
   * @async
   * @return {Promise<Array.<Object>>}
   */

  async getCurrentGlobalStats24h() {
      try {
          let time = await this.getTime()
          let res = await this.get('/main/api/v2/public/stats/global/24h');
          if (res.algos) {
              for (let stat of res.algos) {
                  stat.algo = algorithms[stat.a]
              }
              return res.algos;
          } else
              return { err: "Failed to get current global stats 24h: " }
      } catch (e) {
          return { err: "Failed to get current global stats 24h: ".concat(e) }
      }
  }

  /**
   * Get all orders for certain algorithm. Refreshed every 30 seconds.
   * @param {number} location - 1 for Europe (NiceHash), 2 for USA (WestHash);
   * @param {number|string} algo - Algorithm marked with ID or its name.
   * @async
   * @return {Promise<Array.<Object>>}
   */
  async getOrdersForAlgorithm(market = 0, algo = 0) {
      if (typeof algo === 'number') {
          algo = convertIDtoAlgo(algo)
      }

      if (typeof market === 'number') {
          market = convertLocation(market)
      }

      let query = {
          market: market,
          algorithm: algo,
      }

      this.getTime()
          .then(() => this.get('/main/api/v2/public/orders/', { query }))
          .then(res => {
              return res.list
          })
          .catch(err => {
              throw new Error(
                  `Failed to get all orders for alogrithm: ${err}`
              )
          })
  }

  /**
   * Get information about Simple Multi-Algorithm Mining
   * 
   * {
      miningAlgorithms:[List of mining algorithms ...
          {
              paying:string (Big decimal scaled to 8 decimal points)Mining algorithm price ...
              speed:string (Big decimal scaled to 8 decimal points)Mining algorithm speed ...
              title:string Title ...
              algorithm: SCRYPT | SHA256 | SCRYPTNF | X11 | X13 | KECCAK | X15 | NIST5 | NEOSCRYPT | LYRA2RE | WHIRLPOOLX | QUBIT | QUARK | AXIOM | LYRA2REV2 | SCRYPTJANENF16 | BLAKE256R8 | BLAKE256R14 | BLAKE256R8VNL | HODL | DAGGERHASHIMOTO | DECRED | CRYPTONIGHT | LBRY | EQUIHASH | PASCAL | X11GOST | SIA | BLAKE2S | SKUNK | CRYPTONIGHTV7 | CRYPTONIGHTHEAVY | LYRA2Z | X16R | CRYPTONIGHTV8 | SHA256ASICBOOST | ZHASH | BEAM | GRINCUCKAROO29 | GRINCUCKATOO31 | LYRA2REV3 | CRYPTONIGHTR | CUCKOOCYCLE | GRINCUCKAROOD29 | BEAMV2 | X16RV2 | RANDOMXMONERO | EAGLESONG | CUCKAROOM | GRINCUCKATOO32Algorithm ...
          }
      ]
  }       
   */
  async getSingleMultiAlgoInfo() {
      this.getTime()
          .then(() => this.get('/main/api/v2/public/simplemultialgo/info/'))
          .then(res => {
              return res.miningAlgorithms
          })
          .catch(err => {
              throw new Error(`Failed to get single multi algo info ${err}`)
          })
  }

  async getBuyInfo() {
      this.getTime()
          .then(() => this.get('/main/api/v2/public/buy/info/'))
          .then(res => {
              return res.miningAlgorithms
          })
          .catch(err => {
              throw new Error(`Failed to get buy info: ${err}`)
          })
  }

  /* ----------------------- PRIVATE API -------------------------------------- */

  //getBalance
  /**
   *
   * @param {string} currency - BTC | ETH | XRP | BCH | LTC | ZEC | DASH | XLM | EOS
   *                              | USDT | BSV | LINK | BAT | PAX | ZRX | HOT | OMG | REP
   *                              | NEXO | EURKM | TBTC | TETH | TXRP | TBCH | TLTC | TZEC
   *                              | TDASH | TXLM | TEOS | TERC | TBSV | TEURKM
   */
  // returns list of currency and balance;
  async getBalance(currency = 'BTC') {
      try {
        let time = await this.getTime();
        let balances = await this.get('/main/api/v2/accounting/account2/'+currency);
        let {totalBalance, available, pending, btcRate} = balances;
        return totalBalance
      } catch (e) {
        return {
          err: "Failed to get balance: ".concat(e)
        };
      }
    }

  async getBalanceAndFiat(fiat) {
      this.getTime()
          .then(() => this.get('/main/api/v2/accounting/accounts2?fiat=' + fiat))
          .then(res => {
              return res
          })
          .catch(err => {
              throw new Error(`Failed to get balance and fiat: ${err}`)
          })
    }

  async getExchangeSetting() {
      this.getTime()
          .then(() => this.get('/exchange/api/v2/info/status'))
          .then(res => {
              return res
          })
          .catch(err => {
              throw new Error(`Failed to get exchange setting: ${err}`)
          })
  }

  // not allowed in the U.S.
  async getOrderBook(algo) {
      let query = {
        algorithm: algo
        // algorithm: algo.toUpperCase()
      };
      try {
        let time = await this.getTime();
        let res = await this.get('/main/api/v2/hashpower/orderBook/', {
          query
        })
        return res
      } catch ( err ) {
        throw new Error("Failed to get exchange order book: ".concat(err));
      }
    }

  async getAlgoSetting() {
      this.getTime()
          .then(() => this.get('/main/api/v2/mining/algorithms'))
          .then(res => {
              return res
          })
          .catch(err => {
              throw new Error(`Failed to get algorithm setting: ${err}`)
          })
  }

  //----------------------THEM POOLS----------------------------
  //! enable buying - api or on website
  //   CREATE OR EDIT POOL
  // Create or edit pool info
  // Required permissions:

  // Marketplace / Manage pools (MAPO)
  // creates pool - config for user
  // username is equvilent to flo addy - workername
  //! potential bug - check for typeof algo
  async createOrEditPool(options) {
      let type = options.type || options.algo
      let getTime = await this.getTime()
      let body = {
          algorithm: type.toUpperCase(),
          name: options.name,
          username: options.user,
          password: options.pass,
          stratumHostname: options.host,
          stratumPort: options.port,
          id: options.id || '', //Pool id (Required only if editing pool data)
      }
      try {
          let response = await this.post('/main/api/v2/pool', {
              body
          });
          response.success = true
          return response;
      } catch (e) {
          return {
              error: e.error
          };
      }
  }

  async getPoolInfo(poolId) {
      this.getTime()
          .then(() => {
              return this.get(`/main/api/v2/pool/${poolId}`)
          })
          .then(res => {
              return res
          })
          .catch(err => {
              throw new Error(`Failed to get pool info: ${err}`)
          })
  }

  // delete pool - pass poolId
  async deletePool(poolId) {
      this.getTime()
          .then(() => {
              return this.delete(`/main/api/v2/pool/${poolId}`)
          })
          .then(res => {
              return res
          })
          .catch(err => {
              throw new Error(`Failed to delete pool: ${err}`)
          })
  }

  async getPools(size = 100, page = 0) {
      let query = {
          size,
          page,
      }

      let getTime = await this.getTime()
      try {
          let pools = this.get("/main/api/v2/pools/", { query });
          return pools;
      } catch (err) {
          console.log('err: Catch satement NiceHash.js in src folder line 406', err.error)
          err.message = 'Couldn\'t reach Nicehash\'s api'
          return err;
      }
  }

  async verifyPool(
      password,
      username,
      stratumPort,
      stratumHost,
      miningAlgorithm = 'SCRYPT',
      poolVerificationServiceLocation = 'USA'
  ) {
      let body = {
          password,
          username,
          stratumPort, //number
          stratumHost,
          miningAlgorithm: miningAlgorithm.toUpperCase(),
          poolVerificationServiceLocation: poolVerificationServiceLocation.toUpperCase(), //EUROPE | USA
      }

      this.getTime()
          .then(() => {
              return this.post(`/main/api/v2/pools/verify/`, { body })
          })
          .then(res => {
              return res
          })
          .catch(err => {
              throw new Error(`Failed to verify pool: ${err}`)
          })
  }

  //---------------------- HASHPOWER ORDERS ----------------------------

  /*
CREATE ORDER
Create order
Headers: X-Request-Id: (required, unique identifier of specific request, client should have local awareness that some app action should be done only once on server, if for some reason request is processed by server and client does not know anything about it (request failed). This ID will provide server information that it will not repeat action if it was already processed)

Required permissions:
Marketplace / Place, refill and cancel hashpower orders (PRCO)
*/

  async getOrders(
      algo,
      mk
  ) {
      let status;
      let active;

      // let status = algo['status'] !== undefined ? algo['status'] : 'ALIVE';
      // let active = algo['alive'] !== undefined ? algo['alive'] : true;
      // let market = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : 'USA';
      let ts = arguments.length > 4 ? arguments[4] : undefined;
      let op = arguments.length > 5 ? arguments[5] : undefined;
      let maxResults = arguments.length > 6 ? arguments[6] : undefined;

      try {
        let time = await this.getTime();
        let query = {
          algorithm: ['algo'],
          status,
          active,
          market: ['mk'],
          ts: ts || this.time,
          op: op || 'LE',
          limit: maxResults || 10
        };
        let myOrdersList = await this.get('/main/api/v2/hashpower/myOrders/', {
          query
        });
        let myOrders = myOrdersList.list[0]
        return (myOrders)
      } catch (e) {
        return {
          err: "Failed to get orders: ".concat(e)
        };
      }
  }

  async getDuration(settings) {
      const body = {
          marketFactor: '1000000000000',
          displayMarketFactor: 'TH',
          decreaseFee: true,
          amount: settings.amount,
          limit: settings.limit,
          price: settings.price,
          type: settings.type
      };
  
      try {
          const time = await this.getTime();
          const res = await this.post('/main/api/v2/hashpower/orders/calculateEstimateDuration/', {
              body
          })
          return res
      } catch (err) {
          throw new Error("Failed to get duration: ".concat(err));
      }
  }

  /**
   * Get fixed price on FIXED orders.
   * @param {Object} options - The Options for the rental operation
   * @param {string} options.limit - Hash power 
   * @param {string}  options.algorithm - Algorithm of chosing 
   * @async
   * @return {Promise<Object>} create order 
   */

  async getStandardPrice(algo) {
    const query = {
      // market: 'EU',
      // algorithm: algo.toUpperCase()
      algorithm: algo
    };

    try {
      const time = await this.getTime();
      const res = await this.get('/main/api/v2/hashpower/orders/summaries/', {
        query
      });
      return res;
    } catch (err) {
      console.log("Failed to get standard price: ".concat(err));
      return {
        error: "Failed to get standard price: ".concat(err)
      };
    }
  }
  
  async getFixedPrice(options) {
    const body = {
      limit: options.limit,
      market: 'USA',
      algorithm: options.algorithm.toUpperCase()
    }
  
    try {
      const time = await this.getTime();
      const res = await this.post('/main/api/v2/hashpower/orders/fixedPrice/', {
        body
    });
      return res;
    } catch (err) {
      console.log("Failed to getFixed price: ".concat(err));
      return {
        error: "Failed to getFixed price: ".concat(err)
      };
    }
  }
  /**
   * Create new order. Only standard orders can be created with use of API.
   * @param {Object} options - The Options for the rental operation
   * @param {string} options.type - Hash power order type
   * @param {string|number} options.limit - Speed limit in GH/s or TH/s (0 for no limit)
   * @param {string}  options.id - Pool id
   * @param {string|number} options.price - Price in BTC/GH/day or BTC/TH/day;
   * @param {string} options.marketFactor - (Big decimal scaled to 8 decimal points )Used display market factor (numeric)
   * @param {string} options.displayMarketFactor - Used display market factor
   * @param {string} options.amount   0.005  - Pay amount in BTC;
   * @param {string} options.algorithm- Algorithm name or ID
   * @param {number} options.market - 1 for Europe (NiceHash), 2 for USA (WestHash)
   * @param {string|number} options.token -The coin you wish to rent with
   * @async
   * @return {Promise<Object>} create order 
   */

  async createOrder(options) {
      // if (typeof market === 'number') {
      //     market = convertLocation(market)
      // }
      const body = {
          //STANDARD | FIXED
          type: options.type,
          limit: options.limit,
          poolId: options.id,
          price: options.price,
          marketFactor: options.marketFactor,
          displayMarketFactor: options.displayMarketFactor,
          amount: options.amount,
          market: 'USA',
          algorithm: options.algorithm.toUpperCase()
        };
    
      try {
          const time = await this.getTime()
          return await this.post('/main/api/v2/hashpower/order', { body });
      } catch(err) {
          console.log("Failed to create order: ".concat(err))
          return {error: `Failed to create order: ${err}`}
      }
  }

  /**
   * @param {string} orderId - Order Id
   * @param {string|number} amount - amount in BTC
   */
  async refillOrder(orderId, amount) {
      this.getTime()
          .then(() => {
              var body = {
                  amount,
              }
              return this.post(
                  `/main/api/v2/hashpower/order/${orderId}/refill/`,
                  { body }
              )
          })
          .then(res => {
              return res
          })
          .catch(err => {
              throw new Error(`Failed to refill order: ${err}`)
          })
  }

  async updatePriceandLimit(
      orderId,
      limit,
      price,
      marketFactor = '1000000000000',
      displayMarketFactor = 'TH'
  ) {
      this.getTime()
          .then(() => {
              var body = {
                  marketFactor: marketFactor || '1000000000000',
                  displayMarketFactor: displayMarketFactor || 'TH',
                  limit,
                  price,
              }
              return this.post(
                  `/main/api/v2/hashpower/order/${orderId}/updatePriceAndLimit/`,
                  { body }
              )
          })
          .then(res => {
              return res
          })
          .catch(err => {
              throw new Error(`Failed to update price and limit ${err}`)
          })
  }

  async cancelOrder(orderId) {
      this.getTime()
          .then(() => {
              return this.delete(`/main/api/v2/hashpower/order/${orderId}/`)
          })
          .then(res => {
              return res
          })
          .catch(err => {
              throw new Error(`Failed to cancel order: ${err}`)
          })
  }

  async setOrderPrice() {
      log('not built')
  }

  async decreaseOrderPrice() {
      log('not built')
  }

  async setOrderLimit() {
      log('not built')
  }

  //----------------------------- Withdrawl ------------------------------------

  async createWithdrawlAddress(
      // token, optional 2FA
      type,
      address,
      name,
      currency
  ) {
      let body = {
          type: type.toUpperCase(),
          address,
          name,
          currency: currency.toUpperCase(),
      }

      this.getTime()
          .then(() => {
              return this.post(`/main/api/v2/accounting/withdrawalAddress/`, {
                  body,
              })
          })
          .then(res => {
              return res
          })
          .catch(err => {
              throw new Error(`Fail create withdrawl address ${err}`)
          })
  }

  async createWithdrawlRequest(withdrawalAddressId, amount, currency) {
      let body = {
          withdrawalAddressId,
          amount,
          currency: currency.toUpperCase(),
      }

      this.getTime()
          .then(() => {
              return this.post(`/main/api/v2/accounting/withdrawal/`, {
                  body,
              })
          })
          .then(res => {
              return res
          })
          .catch(err => {
              throw new Error(`Fail create withdrawl address ${err}`)
          })
  }

  async getWithdrawalAddresses(currency, size = 100, page = 0) {
      let query = {
          currency: currency.toUpperCase(),
          size,
          page,
      }

      this.getTime()
          .then(() => {
              return this.get(
                  `/main/api/v2/accounting/withdrawalAddresses/`,
                  { query }
              )
          })
          .then(res => {
              return res
          })
          .catch(err => {
              throw new Error(`Fail get withdrawal addys ${err}`)
          })
  }

  // Deposit Address
  async getDepositAddresses(currency) {

      let query = {
          currency: currency.toUpperCase()
      };
      try {
          const time = await this.getTime();
          const res = await this.get('/main/api/v2/accounting/depositAddresses/', {
              query
          })
          return res
      } catch (err) {
          throw new Error("Failed to get deposit addresses, pass in currency: ".concat(err));
      }
  }
}

export default NiceHash
