import crypto from 'eth-crypto';
import request from 'request';
import uuid4 from 'uuid4';
import Web3 from 'web3';

import TransactionFilters from './models/transactionFilters';
import User from './models/user';
import Wallet from './models/wallet';
import WalletFilters from './models/walletFilters';

let appKey = null;
let appHandle = null;
let sandbox = true;
let env = 'PROD';
let baseUrl = 'https://sandbox.silamoney.com/0.2/';
let logging = false;

const web3 = new Web3('http://52.13.246.239:8080/');

const url = (path) => baseUrl + path;

const getBalanceURL = () => {
  let balanceURL = '';
  switch (env) {
    case 'PROD':
      balanceURL = sandbox
        ? 'https://sandbox.silatokenapi.silamoney.com/silaBalance'
        : 'https://silatokenapi.silamoney.com/silaBalance';
      break;
    default:
      balanceURL = 'https://test.silatokenapi.silamoney.com/silaBalance';
  }
  return balanceURL;
};
/**
 *
 * @param {String} message The message to sign
 * @param {*} key The key to sign the message with
 */
const sign = (message, key) => {
  if (!appKey || !key) {
    throw new Error('Unable to sign request: keys not set');
  }
  const hash = crypto.hash.keccak256(message);
  const signature = crypto.sign(key, hash);

  if (logging && env !== 'PROD') {
    console.log('*** MESSAGE STRING ***');
    console.log(message);
    console.log('*** HASH ***');
    console.log(hash);
    console.log('*** SIGNING WITH KEY ***');
    console.log(key);
    console.log('*** SIGNATURE (remove leading 0x before sending) ***');
    console.log(signature);
  }
  return signature.substr(2);
};

const configureUrl = () => {
  const app = sandbox ? 'sandbox' : 'api';
  if (env === 'PROD') {
    baseUrl = `https://${app}.silamoney.com/0.2/`;
  } else {
    baseUrl = `https://${env.toLowerCase()}.${app}.silamoney.com/0.2/`;
  }
};

/**
 *
 * @param {*} opts
 * @param {*} key
 */
const signOpts = (opts, key, business_private_key) => {
  const options = opts;
  if (opts.body.header) {
    options.headers = {};
    const bodyString = JSON.stringify(options.body);
    options.headers.authsignature = sign(bodyString, appKey);
    if (key) options.headers.usersignature = sign(bodyString, key);
    if (business_private_key) options.headers.businesssignature = sign(bodyString, business_private_key);
  }
  return options;
};

/**
 *
 * @param {Object} msg The header message
 * @param {String} handle The user handle
 */
const setHeaders = (msg, handle, business_handle) => {
  const message = msg;
  message.header.user_handle = handle;
  message.header.business_handle = business_handle;
  message.header.auth_handle = appHandle;
  message.header.reference = uuid4();
  message.header.created = Math.floor(Date.now() / 1000);
  message.header.crypto = 'ETH';
  message.header.version = '0.2';
  return message;
};

const post = (options) => {
  const promise = new Promise((res, rej) => {
    if (logging && env !== 'PROD') {
      console.log('*** REQUEST ***');
      console.log(options.body);
    }
    request.post(options, (err, response, body) => {
      if (err) {
        rej(err);
      }
      res({ statusCode: response.statusCode, data: body });
    });
  });
  return promise;
};

/**
 *
 * @param {String} path The path of the request
 * @param {Object} body The body of the request
 * @param {String} privateKey The user's private key
 */
const makeRequest = (path, body, privateKey = undefined, business_private_key = undefined) => {
  let opts = {
    uri: url(path),
    json: true,
    body,
  };
  opts = signOpts(opts, privateKey, business_private_key);
  return post(opts);
};

/**
 * Returns the handle with the .silamoney.eth suffix if not present
 * @param {String} handle The handle
 */
const getFullHandle = (handle) => {
  let fullHandle = String(handle);
  if (!fullHandle.endsWith('.silamoney.eth')) {
    fullHandle += '.silamoney.eth';
  }
  return fullHandle;
};

/**
 * Makes a call to /check_handle endpoint.
 * @param {String} handle The user handle to check if it's available
 */
const checkHandle = (handle) => {
  const fullHandle = getFullHandle(handle);
  const message = setHeaders({ header: {} }, fullHandle);
  message.message = 'header_msg';

  return makeRequest('check_handle', message);
};

/**
 * Makes a call to /register endpoint.
 * @param {User} user
 */
const register = (user) => {
  const handle = getFullHandle(user.handle);
  const message = setHeaders({ header: {} }, handle);
  message.message = 'entity_msg';

  message.address = {};
  message.address.city = user.city;
  message.address.postal_code = user.zip;
  message.address.state = user.state;
  message.address.street_address_1 = user.address;
  message.address.address_alias = user.addresAlias;
  message.address.country = 'US';

  message.contact = {};
  message.contact.contact_alias = user.contactAlias;
  message.contact.phone = user.phone;
  message.contact.email = user.email;

  message.crypto_entry = {};
  message.crypto_entry.crypto_address = user.cryptoAddress;
  message.crypto_entry.crypto_code = 'ETH';
  message.crypto_entry.crypto_alias = user.cryptoAlias;

  message.entity = {};
  message.entity.birthdate = user.dateOfBirth;
  message.entity.first_name = user.firstName;
  message.entity.last_name = user.lastName;
  message.entity.entity_name = user.entity_name ? user.entity_name : `${user.firstName} ${user.lastName}`;
  message.entity.relationship = 'user';
  message.entity.type = user.business_type ? 'business' : 'individual';
  message.entity.business_type = user.business_type;
  message.entity.business_website = user.business_website;
  message.entity.doing_business_as = user.doing_business_as;
  message.entity.naics_code = user.naics_code;

  message.identity = {};
  message.identity.identity_value = user.ssn ? user.ssn : user.ein;
  message.identity.identity_alias = user.ssn ? 'SSN' : 'EIN';

  return makeRequest('register', message);
};

/**
 * Makes a call to /request_kyc endpoint.
 * @param {String} handle The user handle
 * @param {String} privateKey The user's wallet private key
 * @param {String} kycLevel The custom kyc level
 */
const requestKYC = (handle, privateKey, kycLevel = undefined) => {
  const fullHandle = getFullHandle(handle);
  const message = setHeaders({ header: {} }, fullHandle);
  message.message = 'header_msg';
  if (kycLevel) message.kyc_level = kycLevel;

  return makeRequest('request_kyc', message, privateKey);
};

/**
 * Makes a call to /check_kyc endpoint.
 * @param {String} handle The user handle
 * @param {String} privateKey The user's wallet private key
 */
const checkKYC = (handle, privateKey) => {
  const fullHandle = getFullHandle(handle);
  const message = setHeaders({ header: {} }, fullHandle);
  message.message = 'header_msg';

  return makeRequest('check_kyc', message, privateKey);
};

/**
 * Makes a call to /link_account endpoint.
 * This method handles the direct account link flow
 * @param {String} handle The user handle
 * @param {String} privateKey The user's wallet private key
 * @param {String} accountNumber The account number
 * @param {String} routingNumber The routing number
 * @param {String} accountName The account nickname
 * @param {String} accountType The account type
 */
const linkAccountDirect = (
  handle,
  privateKey,
  accountNumber,
  routingNumber,
  accountName = undefined,
  accountType = undefined,
) => {
  const fullHandle = getFullHandle(handle);
  const message = setHeaders({ header: {} }, fullHandle);
  message.message = 'link_account_msg';
  message.account_number = accountNumber;
  message.routing_number = routingNumber;
  if (accountType) message.account_type = accountType;
  if (accountName) message.account_name = accountName;

  return makeRequest('link_account', message, privateKey);
};

/**
 * Makes a call to /link_account endpoint.
 * This method handles the plaid's token flow.
 * @param {String} handle The user hanlde
 * @param {String} privateKey The user's wallet private key
 * @param {String} publicToken Plaid's public token
 * @param {String} accountName The account nickname
 * @param {String} accountId The account id
 */
const linkAccount = (
  handle,
  privateKey,
  publicToken,
  accountName = undefined,
  accountId = undefined,
) => {
  const fullHandle = getFullHandle(handle);
  const message = setHeaders({ header: {} }, fullHandle);
  message.message = 'link_account_msg';
  message.public_token = publicToken;
  if (accountId) message.account_id = accountId;
  if (accountName) message.account_name = accountName;

  return makeRequest('link_account', message, privateKey);
};

/**
 * Makes a call to /issue_sila endpoint.
 * @param {Number} amount The amount of sila tokens to issue
 * @param {String} handle The user handle
 * @param {String} privateKey The user's wallet private key
 * @param {String} accountName The nickname of the account to debit from. It defaults to 'default' (optional).
 * @param {String} descriptor The transaction descriptor (optional).
 * @param {String} businessUuid The UUID of the business for the ACH name (optional)
 */
const issueSila = (
  amount,
  handle,
  privateKey,
  accountName = 'default',
  descriptor = undefined,
  businessUuid = undefined,
) => {
  const fullHandle = getFullHandle(handle);
  const body = setHeaders({ header: {} }, fullHandle);
  body.amount = amount;
  body.message = 'issue_msg';
  body.account_name = accountName;
  if (descriptor) body.descriptor = descriptor;
  if (businessUuid) body.business_uuid = businessUuid;

  return makeRequest('issue_sila', body, privateKey);
};

/**
 * Makes a call to /redeem_sila endpoint.
 * @param {Number} amount The amount of sila tokens to reedem
 * @param {String} handle The user handle
 * @param {String} privateKey The user's wallet private key
 * @param {String} accountName The account nickname to credit with the tokens' value.
 * @param {String} descriptor The transaction descriptor (optional)
 * @param {String} businessUuid The UUID of the business for the ACH name (optional)
 */
const redeemSila = (
  amount,
  handle,
  privateKey,
  accountName = 'default',
  descriptor = undefined,
  businessUuid = undefined,
) => {
  const fullHandle = getFullHandle(handle);
  const body = setHeaders({ header: {} }, fullHandle);
  body.amount = amount;
  body.message = 'redeem_msg';
  body.account_name = accountName;
  if (descriptor) body.descriptor = descriptor;
  if (businessUuid) body.business_uuid = businessUuid;

  return makeRequest('redeem_sila', body, privateKey);
};

/**
 * Makes a call to /transfer_sila endpoint.
 * @param {String} amount The amount of sila tokens to transfer
 * @param {String} handle The origin user handle
 * @param {String} privateKey The origin user's wallet private key
 * @param {String} destinationHandle The destination user handle
 * @param {String} walletNickname The destination user's wallet nickname (optional)
 * @param {String} walletAddress The destination user's wallet address (optional)
 * @param {String} descriptor The transaction descriptor (optional)
 * @param {String} businessUuid The UUID of the business for the ACH name (optional)
 */
const transferSila = (
  amount,
  handle,
  privateKey,
  destinationHandle,
  walletNickname = undefined,
  walletAddress = undefined,
  descriptor = undefined,
  businessUuid = undefined,
) => {
  const fullHandle = getFullHandle(handle);
  const fullDestination = getFullHandle(destinationHandle);
  const body = setHeaders({ header: {} }, fullHandle);
  body.amount = amount;
  body.destination_handle = fullDestination;
  if (walletNickname) body.destination_wallet = walletNickname;
  if (walletAddress) body.destination_address = walletAddress;
  if (descriptor) body.descriptor = descriptor;
  if (businessUuid) body.business_uuid = businessUuid;

  return makeRequest('transfer_sila', body, privateKey);
};

/**
 * Makes a call to /get_accounts endpoint.
 * @param {String} handle The user handle
 * @param {String} privateKey The user's wallet private key
 */
const getAccounts = (handle, privateKey) => {
  const fullHandle = getFullHandle(handle);
  const body = setHeaders({ header: {} }, fullHandle);
  body.message = 'get_accounts_msg';

  return makeRequest('get_accounts', body, privateKey);
};

/**
 * Makes a call to /get_account_balance endpoint.
 * @param {String} handle The user handle
 * @param {String} privateKey The user's wallet private key
 * @param {String} accountName The account name to retrieve the balance
 */
const getAccountBalance = (handle, privateKey, accountName) => {
  const fullHandle = getFullHandle(handle);
  const body = setHeaders({ header: {} }, fullHandle);
  body.account_name = accountName;

  return makeRequest('get_account_balance', body, privateKey);
};

/**
 * Makes a call to /plaid_sameday_auth endpoint.
 * The account used in this endpoint must be in the microdeposit_pending_manual_verification status.
 * @param {String} handle The user handle
 * @param {String} privateKey The user's wallet private key
 * @param {String} accountName The account nickname
 */
const plaidSamedayAuth = (handle, privateKey, accountName) => {
  const fullHandle = getFullHandle(handle);
  const body = setHeaders({ header: {} }, fullHandle);
  body.account_name = accountName;
  return makeRequest('plaid_sameday_auth', body, privateKey);
};

/**
 * Makes a call to /register_wallet endpoint.
 * If you need a new wallet you can use the generateWallet method.
 * @param {String} handle The user handle
 * @param {String} privateKey An already registered user's wallet private key
 * @param {Wallet} wallet The new wallet
 */
const registerWallet = (handle, privateKey, wallet, nickname) => {
  const fullHandle = getFullHandle(handle);
  const body = setHeaders({ header: {} }, fullHandle);

  body.wallet_verification_signature = sign(wallet.address, wallet.privateKey);

  body.wallet = {};
  body.wallet.blockchain_address = wallet.address;
  body.wallet.blockchain_network = 'ETH';
  if (nickname) body.wallet.nickname = nickname;

  return makeRequest('register_wallet', body, privateKey);
};

/**
 * Makes a call to /get_wallets endpoint and returns the list of wallets that match the filters
 * @param {String} handle The user handle
 * @param {String} privateKey Any of the user's registered wallet's private key
 * @param {WalletFilters} filters The filters used to narrow the search results
 */
const getWallets = (handle, privateKey, filters = undefined) => {
  const fullHandle = getFullHandle(handle);
  const body = setHeaders({ header: {} }, fullHandle);

  if (filters) body.search_filters = filters;

  return makeRequest('get_wallets', body, privateKey);
};

/**
 * Makes a call to /update_wallet endpoint.
 * The wallet to update is the one used to sign the message.
 * @param {String} handle The user handle
 * @param {String} privateKey The user's wallet private key
 * @param {Object} walletProperties The properties to update on the wallet
 */
const updateWallet = (handle, privateKey, walletProperties = {}) => {
  const fullHandle = getFullHandle(handle);
  const body = setHeaders({ header: {} }, fullHandle);

  if (walletProperties) {
    if (walletProperties.nickname) body.nickname = walletProperties.nickname;
    if (walletProperties.default) body.default = walletProperties.default;
  }

  return makeRequest('update_wallet', body, privateKey);
};

/**
 * Makes a call to /get_wallet endpoint.
 * The wallet to retrieve information is the one used to sign the message.
 * @param {String} handle The user handle
 * @param {String} privateKey The user's wallet private key
 */
const getWallet = (handle, privateKey) => {
  const fullHandle = getFullHandle(handle);
  const body = setHeaders({ header: {} }, fullHandle);

  return makeRequest('get_wallet', body, privateKey);
};

/**
 * Makes a call to /delete_wallet endpoint.
 * The wallet to delete is the one used to sign the message.
 * @param {String} handle The user handle
 * @param {String} privateKey The user's wallet private key
 */
const deleteWallet = (handle, privateKey) => {
  const fullHandle = getFullHandle(handle);
  const body = setHeaders({ header: {} }, fullHandle);

  return makeRequest('delete_wallet', body, privateKey);
};

/**
 * Makes a call to /get_transactions endpoint.
 * @param {String} handle The user handle
 * @param {String} privateKey The user's wallet private key
 * @param {TransactionFilters} filters The filters used to narrow the search results
 */
const getTransactions = (handle, privateKey, filters = {}) => {
  const fullHandle = getFullHandle(handle);
  const body = setHeaders({ header: {} }, fullHandle);

  body.message = 'get_transactions_msg';
  body.search_filters = filters;

  return makeRequest('get_transactions', body, privateKey);
};

/**
 * Makes a call to /get_sila_balance endpoint.
 * This method replaces getBalance.
 * @param {String} address The wallet's blockchain address
 */
const getSilaBalance = (address) => {
  const body = { address };

  return makeRequest('get_sila_balance', body);
};

/**
 * Makes a call to /silaBalance endpoint.
 * @param {String} address The wallet's blockchain address
 * @deprecated Since version 0.2.7. Use getSilaBalance instead.
 */
const getBalance = (address) => {
  const body = { address };

  const opts = {
    uri: getBalanceURL(),
    json: true,
    body,
  };

  return post(opts);
};

const getBusinessTypes = () => {
  const body = setHeaders({ header: {} });

  return makeRequest('get_business_types', body);
};

const getBusinessRoles = () => {
  const body = setHeaders({ header: {} });

  return makeRequest('get_business_roles', body);
};

const getNacisCategories = () => {
  const body = setHeaders({ header: {} });

  return makeRequest('get_naics_categories', body);
};

/** 
* @param {String} entity_type optional entity type filter.
*/
const getEntities = (entity_type) => {
  const body = setHeaders({ header: {} });

  body.entity_type = entity_type;

  return makeRequest('get_entities', body);
};

/** 
* @param {String} user_handle
* @param {String} user_private_key
*/
const getEntity = (user_handle, user_private_key) => {
  const body = setHeaders({ header: {} }, user_handle);

  body.user_handle = user_handle;

  return makeRequest('get_entity', body, user_private_key);
};

/** 
* @param {String} user_handle
* @param {String} user_private_key
* @param {String} business_handle
* @param {String} business_private_key
* @param {String} role
* @param {String} member_handle
* @param {String} details
* @param {double} ownership_stake
*/
const linkBusinessMember = (
  user_handle, user_private_key, business_handle, business_private_key, role, member_handle, details,
  ownership_stake
) => {
  const body = setHeaders({ header: {} }, user_handle, business_handle);

  body.role = role;
  body.member_handle = member_handle;
  body.details = details;
  body.ownership_stake = ownership_stake;

  return makeRequest('link_business_member', body, user_private_key, business_private_key);
};

/** 
* @param {String} user_handle
* @param {String} user_private_key
* @param {String} business_handle
* @param {String} business_private_key
* @param {String} role
*/
const unlinkBusinessMember = (
  user_handle, user_private_key, business_handle, business_private_key, role
) => {
  const body = setHeaders({ header: {} }, user_handle, business_handle);

  body.role = role;

  return makeRequest('unlink_business_member', body, user_private_key, business_private_key);
};

/** 
* @param {String} user_handle
* @param {String} user_private_key
* @param {String} business_handle
* @param {String} business_private_key
* @param {String} member_handle
* @param {String} certification_token
*/
const certifyBeneficialOwner = (
  user_handle, user_private_key, business_handle, business_private_key, member_handle, certification_token
) => {
  const body = setHeaders({ header: {} }, user_handle, business_handle);

  body.member_handle = member_handle;
  body.certification_token = certification_token;

  return makeRequest('certify_beneficial_owner', body, user_private_key, business_private_key);
};

/** 
* @param {String} user_handle
* @param {String} user_private_key
* @param {String} business_handle
* @param {String} business_private_key
*/
const certifyBusiness = (
  user_handle, user_private_key, business_handle, business_private_key
) => {
  const body = setHeaders({ header: {} }, user_handle, business_handle);

  return makeRequest('certify_business', body, user_private_key, business_private_key);
};

/**
 *
 * @param {*} params The configuration parameters
 */
const configure = (params) => {
  appKey = params.key;
  appHandle = params.handle;
};

const setEnvironment = (envString) => {
  env = envString.toUpperCase();
  configureUrl();
  console.log(`Setting environment to ${envString.toUpperCase()}: ${baseUrl}`);
};

const enableSandbox = () => {
  sandbox = true;
  configureUrl();
};

const disableSandbox = () => {
  sandbox = false;
  configureUrl();
};

/**
 * @returns {Wallet} A new ETH wallet
 */
const generateWallet = () => {
  const wallet = web3.eth.accounts.create();
  return new Wallet(wallet.address, wallet.privateKey);
};

const setLogging = (log) => {
  logging = !!log;
};

export default {
  checkHandle,
  checkKYC,
  configure,
  deleteWallet,
  disableSandbox,
  enableSandbox,
  generateWallet,
  getAccountBalance,
  getAccounts,
  getBalance,
  getSilaBalance,
  getTransactions,
  getWallet,
  getWallets,
  issueSila,
  linkAccount,
  linkAccountDirect,
  plaidSamedayAuth,
  redeemSila,
  register,
  registerWallet,
  requestKYC,
  setEnvironment,
  setLogging,
  TransactionFilters,
  transferSila,
  updateWallet,
  User,
  WalletFilters,
  getBusinessTypes,
  getBusinessRoles,
  getNacisCategories,
  getEntities,
  linkBusinessMember,
  unlinkBusinessMember,
  getEntity,
  certifyBeneficialOwner,
  certifyBusiness
};
