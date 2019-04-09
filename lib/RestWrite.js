"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _RestQuery = _interopRequireDefault(require("./RestQuery"));

var _lodash = _interopRequireDefault(require("lodash"));

var _logger = _interopRequireDefault(require("./logger"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// A RestWrite encapsulates everything we need to run an operation
// that writes to the database.
// This could be either a "create" or an "update".
var SchemaController = require('./Controllers/SchemaController');

var deepcopy = require('deepcopy');

const Auth = require('./Auth');

var cryptoUtils = require('./cryptoUtils');

var passwordCrypto = require('./password');

var Parse = require('parse/node');

var triggers = require('./triggers');

var ClientSDK = require('./ClientSDK');

// query and data are both provided in REST API format. So data
// types are encoded by plain old objects.
// If query is null, this is a "create" and the data in data should be
// created.
// Otherwise this is an "update" - the object matching the query
// should get updated with data.
// RestWrite will handle objectId, createdAt, and updatedAt for
// everything. It also knows to use triggers and special modifications
// for the _User class.
function RestWrite(config, auth, className, query, data, originalData, clientSDK) {
  if (auth.isReadOnly) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Cannot perform a write operation when using readOnlyMasterKey');
  }

  this.config = config;
  this.auth = auth;
  this.className = className;
  this.clientSDK = clientSDK;
  this.storage = {};
  this.runOptions = {};
  this.context = {};

  if (!query && data.objectId) {
    throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'objectId is an invalid field name.');
  } // When the operation is complete, this.response may have several
  // fields.
  // response: the actual data to be returned
  // status: the http status code. if not present, treated like a 200
  // location: the location header. if not present, no location header


  this.response = null; // Processing this operation may mutate our data, so we operate on a
  // copy

  this.query = deepcopy(query);
  this.data = deepcopy(data); // We never change originalData, so we do not need a deep copy

  this.originalData = originalData; // The timestamp we'll use for this whole operation

  this.updatedAt = Parse._encode(new Date()).iso;
} // A convenient method to perform all the steps of processing the
// write, in order.
// Returns a promise for a {response, status, location} object.
// status and location are optional.


RestWrite.prototype.execute = function () {
  return Promise.resolve().then(() => {
    return this.getUserAndRoleACL();
  }).then(() => {
    return this.validateClientClassCreation();
  }).then(() => {
    return this.handleInstallation();
  }).then(() => {
    return this.handleSession();
  }).then(() => {
    return this.validateAuthData();
  }).then(() => {
    return this.runBeforeTrigger();
  }).then(() => {
    return this.deleteEmailResetTokenIfNeeded();
  }).then(() => {
    return this.validateSchema();
  }).then(() => {
    return this.setRequiredFieldsIfNeeded();
  }).then(() => {
    return this.transformUser();
  }).then(() => {
    return this.expandFilesForExistingObjects();
  }).then(() => {
    return this.destroyDuplicatedSessions();
  }).then(() => {
    return this.runDatabaseOperation();
  }).then(() => {
    return this.createSessionTokenIfNeeded();
  }).then(() => {
    return this.handleFollowup();
  }).then(() => {
    return this.runAfterTrigger();
  }).then(() => {
    return this.cleanUserAuthData();
  }).then(() => {
    return this.response;
  });
}; // Uses the Auth object to get the list of roles, adds the user id


RestWrite.prototype.getUserAndRoleACL = function () {
  if (this.auth.isMaster) {
    return Promise.resolve();
  }

  this.runOptions.acl = ['*'];

  if (this.auth.user) {
    return this.auth.getUserRoles().then(roles => {
      this.runOptions.acl = this.runOptions.acl.concat(roles, [this.auth.user.id]);
      return;
    });
  } else {
    return Promise.resolve();
  }
}; // Validates this operation against the allowClientClassCreation config.


RestWrite.prototype.validateClientClassCreation = function () {
  if (this.config.allowClientClassCreation === false && !this.auth.isMaster && SchemaController.systemClasses.indexOf(this.className) === -1) {
    return this.config.database.loadSchema().then(schemaController => schemaController.hasClass(this.className)).then(hasClass => {
      if (hasClass !== true) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'This user is not allowed to access ' + 'non-existent class: ' + this.className);
      }
    });
  } else {
    return Promise.resolve();
  }
}; // Validates this operation against the schema.


RestWrite.prototype.validateSchema = function () {
  return this.config.database.validateObject(this.className, this.data, this.query, this.runOptions);
}; // Runs any beforeSave triggers against this operation.
// Any change leads to our data being mutated.


RestWrite.prototype.runBeforeTrigger = function () {
  if (this.response) {
    return;
  } // Avoid doing any setup for triggers if there is no 'beforeSave' trigger for this class.


  if (!triggers.triggerExists(this.className, triggers.Types.beforeSave, this.config.applicationId)) {
    return Promise.resolve();
  } // Cloud code gets a bit of extra data for its objects


  var extraData = {
    className: this.className
  };

  if (this.query && this.query.objectId) {
    extraData.objectId = this.query.objectId;
  }

  let originalObject = null;
  const updatedObject = this.buildUpdatedObject(extraData);

  if (this.query && this.query.objectId) {
    // This is an update for existing object.
    originalObject = triggers.inflate(extraData, this.originalData);
  }

  return Promise.resolve().then(() => {
    return triggers.maybeRunTrigger(triggers.Types.beforeSave, this.auth, updatedObject, originalObject, this.config, this.context);
  }).then(response => {
    if (response && response.object) {
      this.storage.fieldsChangedByTrigger = _lodash.default.reduce(response.object, (result, value, key) => {
        if (!_lodash.default.isEqual(this.data[key], value)) {
          result.push(key);
        }

        return result;
      }, []);
      this.data = response.object; // We should delete the objectId for an update write

      if (this.query && this.query.objectId) {
        delete this.data.objectId;
      }
    }
  });
};

RestWrite.prototype.setRequiredFieldsIfNeeded = function () {
  if (this.data) {
    // Add default fields
    this.data.updatedAt = this.updatedAt;

    if (!this.query) {
      this.data.createdAt = this.updatedAt; // Only assign new objectId if we are creating new object

      if (!this.data.objectId) {
        this.data.objectId = cryptoUtils.newObjectId(this.config.objectIdSize);
      }
    }
  }

  return Promise.resolve();
}; // Transforms auth data for a user object.
// Does nothing if this isn't a user object.
// Returns a promise for when we're done if it can't finish this tick.


RestWrite.prototype.validateAuthData = function () {
  if (this.className !== '_User') {
    return;
  }

  if (!this.query && !this.data.authData) {
    if (typeof this.data.username !== 'string' || _lodash.default.isEmpty(this.data.username)) {
      throw new Parse.Error(Parse.Error.USERNAME_MISSING, 'bad or missing username');
    }

    if (typeof this.data.password !== 'string' || _lodash.default.isEmpty(this.data.password)) {
      throw new Parse.Error(Parse.Error.PASSWORD_MISSING, 'password is required');
    }
  }

  if (!this.data.authData || !Object.keys(this.data.authData).length) {
    return;
  }

  var authData = this.data.authData;
  var providers = Object.keys(authData);

  if (providers.length > 0) {
    const canHandleAuthData = providers.reduce((canHandle, provider) => {
      var providerAuthData = authData[provider];
      var hasToken = providerAuthData && providerAuthData.id;
      return canHandle && (hasToken || providerAuthData == null);
    }, true);

    if (canHandleAuthData) {
      return this.handleAuthData(authData);
    }
  }

  throw new Parse.Error(Parse.Error.UNSUPPORTED_SERVICE, 'This authentication method is unsupported.');
};

RestWrite.prototype.handleAuthDataValidation = function (authData) {
  const validations = Object.keys(authData).map(provider => {
    if (authData[provider] === null) {
      return Promise.resolve();
    }

    const validateAuthData = this.config.authDataManager.getValidatorForProvider(provider);

    if (!validateAuthData) {
      throw new Parse.Error(Parse.Error.UNSUPPORTED_SERVICE, 'This authentication method is unsupported.');
    }

    return validateAuthData(authData[provider]);
  });
  return Promise.all(validations);
};

RestWrite.prototype.findUsersWithAuthData = function (authData) {
  const providers = Object.keys(authData);
  const query = providers.reduce((memo, provider) => {
    if (!authData[provider]) {
      return memo;
    }

    const queryKey = `authData.${provider}.id`;
    const query = {};
    query[queryKey] = authData[provider].id;
    memo.push(query);
    return memo;
  }, []).filter(q => {
    return typeof q !== 'undefined';
  });
  let findPromise = Promise.resolve([]);

  if (query.length > 0) {
    findPromise = this.config.database.find(this.className, {
      $or: query
    }, {});
  }

  return findPromise;
};

RestWrite.prototype.filteredObjectsByACL = function (objects) {
  if (this.auth.isMaster) {
    return objects;
  }

  return objects.filter(object => {
    if (!object.ACL) {
      return true; // legacy users that have no ACL field on them
    } // Regular users that have been locked out.


    return object.ACL && Object.keys(object.ACL).length > 0;
  });
};

RestWrite.prototype.handleAuthData = function (authData) {
  let results;
  return this.findUsersWithAuthData(authData).then(r => {
    results = this.filteredObjectsByACL(r);

    if (results.length > 1) {
      // More than 1 user with the passed id's
      throw new Parse.Error(Parse.Error.ACCOUNT_ALREADY_LINKED, 'this auth is already used');
    }

    this.storage['authProvider'] = Object.keys(authData).join(',');

    if (results.length > 0) {
      const userResult = results[0];
      const mutatedAuthData = {};
      Object.keys(authData).forEach(provider => {
        const providerData = authData[provider];
        const userAuthData = userResult.authData[provider];

        if (!_lodash.default.isEqual(providerData, userAuthData)) {
          mutatedAuthData[provider] = providerData;
        }
      });
      const hasMutatedAuthData = Object.keys(mutatedAuthData).length !== 0;
      let userId;

      if (this.query && this.query.objectId) {
        userId = this.query.objectId;
      } else if (this.auth && this.auth.user && this.auth.user.id) {
        userId = this.auth.user.id;
      }

      if (!userId || userId === userResult.objectId) {
        // no user making the call
        // OR the user making the call is the right one
        // Login with auth data
        delete results[0].password; // need to set the objectId first otherwise location has trailing undefined

        this.data.objectId = userResult.objectId;

        if (!this.query || !this.query.objectId) {
          // this a login call, no userId passed
          this.response = {
            response: userResult,
            location: this.location()
          };
        } // If we didn't change the auth data, just keep going


        if (!hasMutatedAuthData) {
          return;
        } // We have authData that is updated on login
        // that can happen when token are refreshed,
        // We should update the token and let the user in
        // We should only check the mutated keys


        return this.handleAuthDataValidation(mutatedAuthData).then(() => {
          // IF we have a response, we'll skip the database operation / beforeSave / afterSave etc...
          // we need to set it up there.
          // We are supposed to have a response only on LOGIN with authData, so we skip those
          // If we're not logging in, but just updating the current user, we can safely skip that part
          if (this.response) {
            // Assign the new authData in the response
            Object.keys(mutatedAuthData).forEach(provider => {
              this.response.response.authData[provider] = mutatedAuthData[provider];
            }); // Run the DB update directly, as 'master'
            // Just update the authData part
            // Then we're good for the user, early exit of sorts

            return this.config.database.update(this.className, {
              objectId: this.data.objectId
            }, {
              authData: mutatedAuthData
            }, {});
          }
        });
      } else if (userId) {
        // Trying to update auth data but users
        // are different
        if (userResult.objectId !== userId) {
          throw new Parse.Error(Parse.Error.ACCOUNT_ALREADY_LINKED, 'this auth is already used');
        } // No auth data was mutated, just keep going


        if (!hasMutatedAuthData) {
          return;
        }
      }
    }

    return this.handleAuthDataValidation(authData);
  });
}; // The non-third-party parts of User transformation


RestWrite.prototype.transformUser = function () {
  var promise = Promise.resolve();

  if (this.className !== '_User') {
    return promise;
  }

  if (!this.auth.isMaster && 'emailVerified' in this.data) {
    const error = `Clients aren't allowed to manually update email verification.`;
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, error);
  } // Do not cleanup session if objectId is not set


  if (this.query && this.objectId()) {
    // If we're updating a _User object, we need to clear out the cache for that user. Find all their
    // session tokens, and remove them from the cache.
    promise = new _RestQuery.default(this.config, Auth.master(this.config), '_Session', {
      user: {
        __type: 'Pointer',
        className: '_User',
        objectId: this.objectId()
      }
    }).execute().then(results => {
      results.results.forEach(session => this.config.cacheController.user.del(session.sessionToken));
    });
  }

  return promise.then(() => {
    // Transform the password
    if (this.data.password === undefined) {
      // ignore only if undefined. should proceed if empty ('')
      return Promise.resolve();
    }

    if (this.query) {
      this.storage['clearSessions'] = true; // Generate a new session only if the user requested

      if (!this.auth.isMaster) {
        this.storage['generateNewSession'] = true;
      }
    }

    return this._validatePasswordPolicy().then(() => {
      return passwordCrypto.hash(this.data.password).then(hashedPassword => {
        this.data._hashed_password = hashedPassword;
        delete this.data.password;
      });
    });
  }).then(() => {
    return this._validateUserName();
  }).then(() => {
    return this._validateEmail();
  });
};

RestWrite.prototype._validateUserName = function () {
  // Check for username uniqueness
  if (!this.data.username) {
    if (!this.query) {
      this.data.username = cryptoUtils.randomString(25);
      this.responseShouldHaveUsername = true;
    }

    return Promise.resolve();
  } // We need to a find to check for duplicate username in case they are missing the unique index on usernames
  // TODO: Check if there is a unique index, and if so, skip this query.


  return this.config.database.find(this.className, {
    username: this.data.username,
    objectId: {
      $ne: this.objectId()
    }
  }, {
    limit: 1
  }).then(results => {
    if (results.length > 0) {
      throw new Parse.Error(Parse.Error.USERNAME_TAKEN, 'Account already exists for this username.');
    }

    return;
  });
};

RestWrite.prototype._validateEmail = function () {
  if (!this.data.email || this.data.email.__op === 'Delete') {
    return Promise.resolve();
  } // Validate basic email address format


  if (!this.data.email.match(/^.+@.+$/)) {
    return Promise.reject(new Parse.Error(Parse.Error.INVALID_EMAIL_ADDRESS, 'Email address format is invalid.'));
  } // Same problem for email as above for username


  return this.config.database.find(this.className, {
    email: this.data.email,
    objectId: {
      $ne: this.objectId()
    }
  }, {
    limit: 1
  }).then(results => {
    if (results.length > 0) {
      throw new Parse.Error(Parse.Error.EMAIL_TAKEN, 'Account already exists for this email address.');
    }

    if (!this.data.authData || !Object.keys(this.data.authData).length || Object.keys(this.data.authData).length === 1 && Object.keys(this.data.authData)[0] === 'anonymous') {
      // We updated the email, send a new validation
      this.storage['sendVerificationEmail'] = true;
      this.config.userController.setEmailVerifyToken(this.data);
    }
  });
};

RestWrite.prototype._validatePasswordPolicy = function () {
  if (!this.config.passwordPolicy) return Promise.resolve();
  return this._validatePasswordRequirements().then(() => {
    return this._validatePasswordHistory();
  });
};

RestWrite.prototype._validatePasswordRequirements = function () {
  // check if the password conforms to the defined password policy if configured
  // If we specified a custom error in our configuration use it.
  // Example: "Passwords must include a Capital Letter, Lowercase Letter, and a number."
  //
  // This is especially useful on the generic "password reset" page,
  // as it allows the programmer to communicate specific requirements instead of:
  // a. making the user guess whats wrong
  // b. making a custom password reset page that shows the requirements
  const policyError = this.config.passwordPolicy.validationError ? this.config.passwordPolicy.validationError : 'Password does not meet the Password Policy requirements.';
  const containsUsernameError = 'Password cannot contain your username.'; // check whether the password meets the password strength requirements

  if (this.config.passwordPolicy.patternValidator && !this.config.passwordPolicy.patternValidator(this.data.password) || this.config.passwordPolicy.validatorCallback && !this.config.passwordPolicy.validatorCallback(this.data.password)) {
    return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, policyError));
  } // check whether password contain username


  if (this.config.passwordPolicy.doNotAllowUsername === true) {
    if (this.data.username) {
      // username is not passed during password reset
      if (this.data.password.indexOf(this.data.username) >= 0) return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, containsUsernameError));
    } else {
      // retrieve the User object using objectId during password reset
      return this.config.database.find('_User', {
        objectId: this.objectId()
      }).then(results => {
        if (results.length != 1) {
          throw undefined;
        }

        if (this.data.password.indexOf(results[0].username) >= 0) return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, containsUsernameError));
        return Promise.resolve();
      });
    }
  }

  return Promise.resolve();
};

RestWrite.prototype._validatePasswordHistory = function () {
  // check whether password is repeating from specified history
  if (this.query && this.config.passwordPolicy.maxPasswordHistory) {
    return this.config.database.find('_User', {
      objectId: this.objectId()
    }, {
      keys: ['_password_history', '_hashed_password']
    }).then(results => {
      if (results.length != 1) {
        throw undefined;
      }

      const user = results[0];
      let oldPasswords = [];
      if (user._password_history) oldPasswords = _lodash.default.take(user._password_history, this.config.passwordPolicy.maxPasswordHistory - 1);
      oldPasswords.push(user.password);
      const newPassword = this.data.password; // compare the new password hash with all old password hashes

      const promises = oldPasswords.map(function (hash) {
        return passwordCrypto.compare(newPassword, hash).then(result => {
          if (result) // reject if there is a match
            return Promise.reject('REPEAT_PASSWORD');
          return Promise.resolve();
        });
      }); // wait for all comparisons to complete

      return Promise.all(promises).then(() => {
        return Promise.resolve();
      }).catch(err => {
        if (err === 'REPEAT_PASSWORD') // a match was found
          return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, `New password should not be the same as last ${this.config.passwordPolicy.maxPasswordHistory} passwords.`));
        throw err;
      });
    });
  }

  return Promise.resolve();
};

RestWrite.prototype.createSessionTokenIfNeeded = function () {
  if (this.className !== '_User') {
    return;
  }

  if (this.query) {
    return;
  }

  if (!this.storage['authProvider'] && // signup call, with
  this.config.preventLoginWithUnverifiedEmail && // no login without verification
  this.config.verifyUserEmails) {
    // verification is on
    return; // do not create the session token in that case!
  }

  return this.createSessionToken();
};

RestWrite.prototype.createSessionToken = function () {
  // cloud installationId from Cloud Code,
  // never create session tokens from there.
  if (this.auth.installationId && this.auth.installationId === 'cloud') {
    return;
  }

  const {
    sessionData,
    createSession
  } = Auth.createSession(this.config, {
    userId: this.objectId(),
    createdWith: {
      action: this.storage['authProvider'] ? 'login' : 'signup',
      authProvider: this.storage['authProvider'] || 'password'
    },
    installationId: this.auth.installationId
  });

  if (this.response && this.response.response) {
    this.response.response.sessionToken = sessionData.sessionToken;
  }

  return createSession();
}; // Delete email reset tokens if user is changing password or email.


RestWrite.prototype.deleteEmailResetTokenIfNeeded = function () {
  if (this.className !== '_User' || this.query === null) {
    // null query means create
    return;
  }

  if ('password' in this.data || 'email' in this.data) {
    const addOps = {
      _perishable_token: {
        __op: 'Delete'
      },
      _perishable_token_expires_at: {
        __op: 'Delete'
      }
    };
    this.data = Object.assign(this.data, addOps);
  }
};

RestWrite.prototype.destroyDuplicatedSessions = function () {
  // Only for _Session, and at creation time
  if (this.className != '_Session' || this.query) {
    return;
  } // Destroy the sessions in 'Background'


  const {
    user,
    installationId,
    sessionToken
  } = this.data;

  if (!user || !installationId) {
    return;
  }

  if (!user.objectId) {
    return;
  }

  this.config.database.destroy('_Session', {
    user,
    installationId,
    sessionToken: {
      $ne: sessionToken
    }
  });
}; // Handles any followup logic


RestWrite.prototype.handleFollowup = function () {
  if (this.storage && this.storage['clearSessions'] && this.config.revokeSessionOnPasswordReset) {
    var sessionQuery = {
      user: {
        __type: 'Pointer',
        className: '_User',
        objectId: this.objectId()
      }
    };
    delete this.storage['clearSessions'];
    return this.config.database.destroy('_Session', sessionQuery).then(this.handleFollowup.bind(this));
  }

  if (this.storage && this.storage['generateNewSession']) {
    delete this.storage['generateNewSession'];
    return this.createSessionToken().then(this.handleFollowup.bind(this));
  }

  if (this.storage && this.storage['sendVerificationEmail']) {
    delete this.storage['sendVerificationEmail']; // Fire and forget!

    this.config.userController.sendVerificationEmail(this.data);
    return this.handleFollowup.bind(this);
  }
}; // Handles the _Session class specialness.
// Does nothing if this isn't an _Session object.


RestWrite.prototype.handleSession = function () {
  if (this.response || this.className !== '_Session') {
    return;
  }

  if (!this.auth.user && !this.auth.isMaster) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Session token required.');
  } // TODO: Verify proper error to throw


  if (this.data.ACL) {
    throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'Cannot set ' + 'ACL on a Session.');
  }

  if (this.query) {
    if (this.data.user && !this.auth.isMaster && this.data.user.objectId != this.auth.user.id) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME);
    } else if (this.data.installationId) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME);
    } else if (this.data.sessionToken) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME);
    }
  }

  if (!this.query && !this.auth.isMaster) {
    const additionalSessionData = {};

    for (var key in this.data) {
      if (key === 'objectId' || key === 'user') {
        continue;
      }

      additionalSessionData[key] = this.data[key];
    }

    const {
      sessionData,
      createSession
    } = Auth.createSession(this.config, {
      userId: this.auth.user.id,
      createdWith: {
        action: 'create'
      },
      additionalSessionData
    });
    return createSession().then(results => {
      if (!results.response) {
        throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'Error creating session.');
      }

      sessionData['objectId'] = results.response['objectId'];
      this.response = {
        status: 201,
        location: results.location,
        response: sessionData
      };
    });
  }
}; // Handles the _Installation class specialness.
// Does nothing if this isn't an installation object.
// If an installation is found, this can mutate this.query and turn a create
// into an update.
// Returns a promise for when we're done if it can't finish this tick.


RestWrite.prototype.handleInstallation = function () {
  if (this.response || this.className !== '_Installation') {
    return;
  }

  if (!this.query && !this.data.deviceToken && !this.data.installationId && !this.auth.installationId) {
    throw new Parse.Error(135, 'at least one ID field (deviceToken, installationId) ' + 'must be specified in this operation');
  } // If the device token is 64 characters long, we assume it is for iOS
  // and lowercase it.


  if (this.data.deviceToken && this.data.deviceToken.length == 64) {
    this.data.deviceToken = this.data.deviceToken.toLowerCase();
  } // We lowercase the installationId if present


  if (this.data.installationId) {
    this.data.installationId = this.data.installationId.toLowerCase();
  }

  let installationId = this.data.installationId; // If data.installationId is not set and we're not master, we can lookup in auth

  if (!installationId && !this.auth.isMaster) {
    installationId = this.auth.installationId;
  }

  if (installationId) {
    installationId = installationId.toLowerCase();
  } // Updating _Installation but not updating anything critical


  if (this.query && !this.data.deviceToken && !installationId && !this.data.deviceType) {
    return;
  }

  var promise = Promise.resolve();
  var idMatch; // Will be a match on either objectId or installationId

  var objectIdMatch;
  var installationIdMatch;
  var deviceTokenMatches = []; // Instead of issuing 3 reads, let's do it with one OR.

  const orQueries = [];

  if (this.query && this.query.objectId) {
    orQueries.push({
      objectId: this.query.objectId
    });
  }

  if (installationId) {
    orQueries.push({
      installationId: installationId
    });
  }

  if (this.data.deviceToken) {
    orQueries.push({
      deviceToken: this.data.deviceToken
    });
  }

  if (orQueries.length == 0) {
    return;
  }

  promise = promise.then(() => {
    return this.config.database.find('_Installation', {
      $or: orQueries
    }, {});
  }).then(results => {
    results.forEach(result => {
      if (this.query && this.query.objectId && result.objectId == this.query.objectId) {
        objectIdMatch = result;
      }

      if (result.installationId == installationId) {
        installationIdMatch = result;
      }

      if (result.deviceToken == this.data.deviceToken) {
        deviceTokenMatches.push(result);
      }
    }); // Sanity checks when running a query

    if (this.query && this.query.objectId) {
      if (!objectIdMatch) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Object not found for update.');
      }

      if (this.data.installationId && objectIdMatch.installationId && this.data.installationId !== objectIdMatch.installationId) {
        throw new Parse.Error(136, 'installationId may not be changed in this ' + 'operation');
      }

      if (this.data.deviceToken && objectIdMatch.deviceToken && this.data.deviceToken !== objectIdMatch.deviceToken && !this.data.installationId && !objectIdMatch.installationId) {
        throw new Parse.Error(136, 'deviceToken may not be changed in this ' + 'operation');
      }

      if (this.data.deviceType && this.data.deviceType && this.data.deviceType !== objectIdMatch.deviceType) {
        throw new Parse.Error(136, 'deviceType may not be changed in this ' + 'operation');
      }
    }

    if (this.query && this.query.objectId && objectIdMatch) {
      idMatch = objectIdMatch;
    }

    if (installationId && installationIdMatch) {
      idMatch = installationIdMatch;
    } // need to specify deviceType only if it's new


    if (!this.query && !this.data.deviceType && !idMatch) {
      throw new Parse.Error(135, 'deviceType must be specified in this operation');
    }
  }).then(() => {
    if (!idMatch) {
      if (!deviceTokenMatches.length) {
        return;
      } else if (deviceTokenMatches.length == 1 && (!deviceTokenMatches[0]['installationId'] || !installationId)) {
        // Single match on device token but none on installationId, and either
        // the passed object or the match is missing an installationId, so we
        // can just return the match.
        return deviceTokenMatches[0]['objectId'];
      } else if (!this.data.installationId) {
        throw new Parse.Error(132, 'Must specify installationId when deviceToken ' + 'matches multiple Installation objects');
      } else {
        // Multiple device token matches and we specified an installation ID,
        // or a single match where both the passed and matching objects have
        // an installation ID. Try cleaning out old installations that match
        // the deviceToken, and return nil to signal that a new object should
        // be created.
        var delQuery = {
          deviceToken: this.data.deviceToken,
          installationId: {
            $ne: installationId
          }
        };

        if (this.data.appIdentifier) {
          delQuery['appIdentifier'] = this.data.appIdentifier;
        }

        this.config.database.destroy('_Installation', delQuery).catch(err => {
          if (err.code == Parse.Error.OBJECT_NOT_FOUND) {
            // no deletions were made. Can be ignored.
            return;
          } // rethrow the error


          throw err;
        });
        return;
      }
    } else {
      if (deviceTokenMatches.length == 1 && !deviceTokenMatches[0]['installationId']) {
        // Exactly one device token match and it doesn't have an installation
        // ID. This is the one case where we want to merge with the existing
        // object.
        const delQuery = {
          objectId: idMatch.objectId
        };
        return this.config.database.destroy('_Installation', delQuery).then(() => {
          return deviceTokenMatches[0]['objectId'];
        }).catch(err => {
          if (err.code == Parse.Error.OBJECT_NOT_FOUND) {
            // no deletions were made. Can be ignored
            return;
          } // rethrow the error


          throw err;
        });
      } else {
        if (this.data.deviceToken && idMatch.deviceToken != this.data.deviceToken) {
          // We're setting the device token on an existing installation, so
          // we should try cleaning out old installations that match this
          // device token.
          const delQuery = {
            deviceToken: this.data.deviceToken
          }; // We have a unique install Id, use that to preserve
          // the interesting installation

          if (this.data.installationId) {
            delQuery['installationId'] = {
              $ne: this.data.installationId
            };
          } else if (idMatch.objectId && this.data.objectId && idMatch.objectId == this.data.objectId) {
            // we passed an objectId, preserve that instalation
            delQuery['objectId'] = {
              $ne: idMatch.objectId
            };
          } else {
            // What to do here? can't really clean up everything...
            return idMatch.objectId;
          }

          if (this.data.appIdentifier) {
            delQuery['appIdentifier'] = this.data.appIdentifier;
          }

          this.config.database.destroy('_Installation', delQuery).catch(err => {
            if (err.code == Parse.Error.OBJECT_NOT_FOUND) {
              // no deletions were made. Can be ignored.
              return;
            } // rethrow the error


            throw err;
          });
        } // In non-merge scenarios, just return the installation match id


        return idMatch.objectId;
      }
    }
  }).then(objId => {
    if (objId) {
      this.query = {
        objectId: objId
      };
      delete this.data.objectId;
      delete this.data.createdAt;
    } // TODO: Validate ops (add/remove on channels, $inc on badge, etc.)

  });
  return promise;
}; // If we short-circuted the object response - then we need to make sure we expand all the files,
// since this might not have a query, meaning it won't return the full result back.
// TODO: (nlutsenko) This should die when we move to per-class based controllers on _Session/_User


RestWrite.prototype.expandFilesForExistingObjects = function () {
  // Check whether we have a short-circuited response - only then run expansion.
  if (this.response && this.response.response) {
    this.config.filesController.expandFilesInObject(this.config, this.response.response);
  }
};

RestWrite.prototype.runDatabaseOperation = function () {
  if (this.response) {
    return;
  }

  if (this.className === '_Role') {
    this.config.cacheController.role.clear();
  }

  if (this.className === '_User' && this.query && this.auth.isUnauthenticated()) {
    throw new Parse.Error(Parse.Error.SESSION_MISSING, `Cannot modify user ${this.query.objectId}.`);
  }

  if (this.className === '_Product' && this.data.download) {
    this.data.downloadName = this.data.download.name;
  } // TODO: Add better detection for ACL, ensuring a user can't be locked from
  //       their own user record.


  if (this.data.ACL && this.data.ACL['*unresolved']) {
    throw new Parse.Error(Parse.Error.INVALID_ACL, 'Invalid ACL.');
  }

  if (this.query) {
    // Force the user to not lockout
    // Matched with parse.com
    if (this.className === '_User' && this.data.ACL && this.auth.isMaster !== true) {
      this.data.ACL[this.query.objectId] = {
        read: true,
        write: true
      };
    } // update password timestamp if user password is being changed


    if (this.className === '_User' && this.data._hashed_password && this.config.passwordPolicy && this.config.passwordPolicy.maxPasswordAge) {
      this.data._password_changed_at = Parse._encode(new Date());
    } // Ignore createdAt when update


    delete this.data.createdAt;
    let defer = Promise.resolve(); // if password history is enabled then save the current password to history

    if (this.className === '_User' && this.data._hashed_password && this.config.passwordPolicy && this.config.passwordPolicy.maxPasswordHistory) {
      defer = this.config.database.find('_User', {
        objectId: this.objectId()
      }, {
        keys: ['_password_history', '_hashed_password']
      }).then(results => {
        if (results.length != 1) {
          throw undefined;
        }

        const user = results[0];
        let oldPasswords = [];

        if (user._password_history) {
          oldPasswords = _lodash.default.take(user._password_history, this.config.passwordPolicy.maxPasswordHistory);
        } //n-1 passwords go into history including last password


        while (oldPasswords.length > this.config.passwordPolicy.maxPasswordHistory - 2) {
          oldPasswords.shift();
        }

        oldPasswords.push(user.password);
        this.data._password_history = oldPasswords;
      });
    }

    return defer.then(() => {
      // Run an update
      return this.config.database.update(this.className, this.query, this.data, this.runOptions).then(response => {
        response.updatedAt = this.updatedAt;

        this._updateResponseWithData(response, this.data);

        this.response = {
          response
        };
      });
    });
  } else {
    // Set the default ACL and password timestamp for the new _User
    if (this.className === '_User') {
      var ACL = this.data.ACL; // default public r/w ACL

      if (!ACL) {
        ACL = {};
        ACL['*'] = {
          read: true,
          write: false
        };
      } // make sure the user is not locked down


      ACL[this.data.objectId] = {
        read: true,
        write: true
      };
      this.data.ACL = ACL; // password timestamp to be used when password expiry policy is enforced

      if (this.config.passwordPolicy && this.config.passwordPolicy.maxPasswordAge) {
        this.data._password_changed_at = Parse._encode(new Date());
      }
    } // Run a create


    return this.config.database.create(this.className, this.data, this.runOptions).catch(error => {
      if (this.className !== '_User' || error.code !== Parse.Error.DUPLICATE_VALUE) {
        throw error;
      } // Quick check, if we were able to infer the duplicated field name


      if (error && error.userInfo && error.userInfo.duplicated_field === 'username') {
        throw new Parse.Error(Parse.Error.USERNAME_TAKEN, 'Account already exists for this username.');
      }

      if (error && error.userInfo && error.userInfo.duplicated_field === 'email') {
        throw new Parse.Error(Parse.Error.EMAIL_TAKEN, 'Account already exists for this email address.');
      } // If this was a failed user creation due to username or email already taken, we need to
      // check whether it was username or email and return the appropriate error.
      // Fallback to the original method
      // TODO: See if we can later do this without additional queries by using named indexes.


      return this.config.database.find(this.className, {
        username: this.data.username,
        objectId: {
          $ne: this.objectId()
        }
      }, {
        limit: 1
      }).then(results => {
        if (results.length > 0) {
          throw new Parse.Error(Parse.Error.USERNAME_TAKEN, 'Account already exists for this username.');
        }

        return this.config.database.find(this.className, {
          email: this.data.email,
          objectId: {
            $ne: this.objectId()
          }
        }, {
          limit: 1
        });
      }).then(results => {
        if (results.length > 0) {
          throw new Parse.Error(Parse.Error.EMAIL_TAKEN, 'Account already exists for this email address.');
        }

        throw new Parse.Error(Parse.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
      });
    }).then(response => {
      response.objectId = this.data.objectId;
      response.createdAt = this.data.createdAt;

      if (this.responseShouldHaveUsername) {
        response.username = this.data.username;
      }

      this._updateResponseWithData(response, this.data);

      this.response = {
        status: 201,
        response,
        location: this.location()
      };
    });
  }
}; // Returns nothing - doesn't wait for the trigger.


RestWrite.prototype.runAfterTrigger = function () {
  if (!this.response || !this.response.response) {
    return;
  } // Avoid doing any setup for triggers if there is no 'afterSave' trigger for this class.


  const hasAfterSaveHook = triggers.triggerExists(this.className, triggers.Types.afterSave, this.config.applicationId);
  const hasLiveQuery = this.config.liveQueryController.hasLiveQuery(this.className);

  if (!hasAfterSaveHook && !hasLiveQuery) {
    return Promise.resolve();
  }

  var extraData = {
    className: this.className
  };

  if (this.query && this.query.objectId) {
    extraData.objectId = this.query.objectId;
  } // Build the original object, we only do this for a update write.


  let originalObject;

  if (this.query && this.query.objectId) {
    originalObject = triggers.inflate(extraData, this.originalData);
  } // Build the inflated object, different from beforeSave, originalData is not empty
  // since developers can change data in the beforeSave.


  const updatedObject = this.buildUpdatedObject(extraData);

  updatedObject._handleSaveResponse(this.response.response, this.response.status || 200);

  this.config.database.loadSchema().then(schemaController => {
    // Notifiy LiveQueryServer if possible
    const perms = schemaController.getClassLevelPermissions(updatedObject.className);
    this.config.liveQueryController.onAfterSave(updatedObject.className, updatedObject, originalObject, perms);
  }); // Run afterSave trigger

  return triggers.maybeRunTrigger(triggers.Types.afterSave, this.auth, updatedObject, originalObject, this.config, this.context).catch(function (err) {
    _logger.default.warn('afterSave caught an error', err);
  });
}; // A helper to figure out what location this operation happens at.


RestWrite.prototype.location = function () {
  var middle = this.className === '_User' ? '/users/' : '/classes/' + this.className + '/';
  return this.config.mount + middle + this.data.objectId;
}; // A helper to get the object id for this operation.
// Because it could be either on the query or on the data


RestWrite.prototype.objectId = function () {
  return this.data.objectId || this.query.objectId;
}; // Returns a copy of the data and delete bad keys (_auth_data, _hashed_password...)


RestWrite.prototype.sanitizedData = function () {
  const data = Object.keys(this.data).reduce((data, key) => {
    // Regexp comes from Parse.Object.prototype.validate
    if (!/^[A-Za-z][0-9A-Za-z_]*$/.test(key)) {
      delete data[key];
    }

    return data;
  }, deepcopy(this.data));
  return Parse._decode(undefined, data);
}; // Returns an updated copy of the object


RestWrite.prototype.buildUpdatedObject = function (extraData) {
  const updatedObject = triggers.inflate(extraData, this.originalData);
  Object.keys(this.data).reduce(function (data, key) {
    if (key.indexOf('.') > 0) {
      // subdocument key with dot notation ('x.y':v => 'x':{'y':v})
      const splittedKey = key.split('.');
      const parentProp = splittedKey[0];
      let parentVal = updatedObject.get(parentProp);

      if (typeof parentVal !== 'object') {
        parentVal = {};
      }

      parentVal[splittedKey[1]] = data[key];
      updatedObject.set(parentProp, parentVal);
      delete data[key];
    }

    return data;
  }, deepcopy(this.data));
  updatedObject.set(this.sanitizedData());
  return updatedObject;
};

RestWrite.prototype.cleanUserAuthData = function () {
  if (this.response && this.response.response && this.className === '_User') {
    const user = this.response.response;

    if (user.authData) {
      Object.keys(user.authData).forEach(provider => {
        if (user.authData[provider] === null) {
          delete user.authData[provider];
        }
      });

      if (Object.keys(user.authData).length == 0) {
        delete user.authData;
      }
    }
  }
};

RestWrite.prototype._updateResponseWithData = function (response, data) {
  if (_lodash.default.isEmpty(this.storage.fieldsChangedByTrigger)) {
    return response;
  }

  const clientSupportsDelete = ClientSDK.supportsForwardDelete(this.clientSDK);
  this.storage.fieldsChangedByTrigger.forEach(fieldName => {
    const dataValue = data[fieldName];

    if (!response.hasOwnProperty(fieldName)) {
      response[fieldName] = dataValue;
    } // Strips operations from responses


    if (response[fieldName] && response[fieldName].__op) {
      delete response[fieldName];

      if (clientSupportsDelete && dataValue.__op == 'Delete') {
        response[fieldName] = dataValue;
      }
    }
  });
  return response;
};

var _default = RestWrite;
exports.default = _default;
module.exports = RestWrite;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9SZXN0V3JpdGUuanMiXSwibmFtZXMiOlsiU2NoZW1hQ29udHJvbGxlciIsInJlcXVpcmUiLCJkZWVwY29weSIsIkF1dGgiLCJjcnlwdG9VdGlscyIsInBhc3N3b3JkQ3J5cHRvIiwiUGFyc2UiLCJ0cmlnZ2VycyIsIkNsaWVudFNESyIsIlJlc3RXcml0ZSIsImNvbmZpZyIsImF1dGgiLCJjbGFzc05hbWUiLCJxdWVyeSIsImRhdGEiLCJvcmlnaW5hbERhdGEiLCJjbGllbnRTREsiLCJpc1JlYWRPbmx5IiwiRXJyb3IiLCJPUEVSQVRJT05fRk9SQklEREVOIiwic3RvcmFnZSIsInJ1bk9wdGlvbnMiLCJjb250ZXh0Iiwib2JqZWN0SWQiLCJJTlZBTElEX0tFWV9OQU1FIiwicmVzcG9uc2UiLCJ1cGRhdGVkQXQiLCJfZW5jb2RlIiwiRGF0ZSIsImlzbyIsInByb3RvdHlwZSIsImV4ZWN1dGUiLCJQcm9taXNlIiwicmVzb2x2ZSIsInRoZW4iLCJnZXRVc2VyQW5kUm9sZUFDTCIsInZhbGlkYXRlQ2xpZW50Q2xhc3NDcmVhdGlvbiIsImhhbmRsZUluc3RhbGxhdGlvbiIsImhhbmRsZVNlc3Npb24iLCJ2YWxpZGF0ZUF1dGhEYXRhIiwicnVuQmVmb3JlVHJpZ2dlciIsImRlbGV0ZUVtYWlsUmVzZXRUb2tlbklmTmVlZGVkIiwidmFsaWRhdGVTY2hlbWEiLCJzZXRSZXF1aXJlZEZpZWxkc0lmTmVlZGVkIiwidHJhbnNmb3JtVXNlciIsImV4cGFuZEZpbGVzRm9yRXhpc3RpbmdPYmplY3RzIiwiZGVzdHJveUR1cGxpY2F0ZWRTZXNzaW9ucyIsInJ1bkRhdGFiYXNlT3BlcmF0aW9uIiwiY3JlYXRlU2Vzc2lvblRva2VuSWZOZWVkZWQiLCJoYW5kbGVGb2xsb3d1cCIsInJ1bkFmdGVyVHJpZ2dlciIsImNsZWFuVXNlckF1dGhEYXRhIiwiaXNNYXN0ZXIiLCJhY2wiLCJ1c2VyIiwiZ2V0VXNlclJvbGVzIiwicm9sZXMiLCJjb25jYXQiLCJpZCIsImFsbG93Q2xpZW50Q2xhc3NDcmVhdGlvbiIsInN5c3RlbUNsYXNzZXMiLCJpbmRleE9mIiwiZGF0YWJhc2UiLCJsb2FkU2NoZW1hIiwic2NoZW1hQ29udHJvbGxlciIsImhhc0NsYXNzIiwidmFsaWRhdGVPYmplY3QiLCJ0cmlnZ2VyRXhpc3RzIiwiVHlwZXMiLCJiZWZvcmVTYXZlIiwiYXBwbGljYXRpb25JZCIsImV4dHJhRGF0YSIsIm9yaWdpbmFsT2JqZWN0IiwidXBkYXRlZE9iamVjdCIsImJ1aWxkVXBkYXRlZE9iamVjdCIsImluZmxhdGUiLCJtYXliZVJ1blRyaWdnZXIiLCJvYmplY3QiLCJmaWVsZHNDaGFuZ2VkQnlUcmlnZ2VyIiwiXyIsInJlZHVjZSIsInJlc3VsdCIsInZhbHVlIiwia2V5IiwiaXNFcXVhbCIsInB1c2giLCJjcmVhdGVkQXQiLCJuZXdPYmplY3RJZCIsIm9iamVjdElkU2l6ZSIsImF1dGhEYXRhIiwidXNlcm5hbWUiLCJpc0VtcHR5IiwiVVNFUk5BTUVfTUlTU0lORyIsInBhc3N3b3JkIiwiUEFTU1dPUkRfTUlTU0lORyIsIk9iamVjdCIsImtleXMiLCJsZW5ndGgiLCJwcm92aWRlcnMiLCJjYW5IYW5kbGVBdXRoRGF0YSIsImNhbkhhbmRsZSIsInByb3ZpZGVyIiwicHJvdmlkZXJBdXRoRGF0YSIsImhhc1Rva2VuIiwiaGFuZGxlQXV0aERhdGEiLCJVTlNVUFBPUlRFRF9TRVJWSUNFIiwiaGFuZGxlQXV0aERhdGFWYWxpZGF0aW9uIiwidmFsaWRhdGlvbnMiLCJtYXAiLCJhdXRoRGF0YU1hbmFnZXIiLCJnZXRWYWxpZGF0b3JGb3JQcm92aWRlciIsImFsbCIsImZpbmRVc2Vyc1dpdGhBdXRoRGF0YSIsIm1lbW8iLCJxdWVyeUtleSIsImZpbHRlciIsInEiLCJmaW5kUHJvbWlzZSIsImZpbmQiLCIkb3IiLCJmaWx0ZXJlZE9iamVjdHNCeUFDTCIsIm9iamVjdHMiLCJBQ0wiLCJyZXN1bHRzIiwiciIsIkFDQ09VTlRfQUxSRUFEWV9MSU5LRUQiLCJqb2luIiwidXNlclJlc3VsdCIsIm11dGF0ZWRBdXRoRGF0YSIsImZvckVhY2giLCJwcm92aWRlckRhdGEiLCJ1c2VyQXV0aERhdGEiLCJoYXNNdXRhdGVkQXV0aERhdGEiLCJ1c2VySWQiLCJsb2NhdGlvbiIsInVwZGF0ZSIsInByb21pc2UiLCJlcnJvciIsIlJlc3RRdWVyeSIsIm1hc3RlciIsIl9fdHlwZSIsInNlc3Npb24iLCJjYWNoZUNvbnRyb2xsZXIiLCJkZWwiLCJzZXNzaW9uVG9rZW4iLCJ1bmRlZmluZWQiLCJfdmFsaWRhdGVQYXNzd29yZFBvbGljeSIsImhhc2giLCJoYXNoZWRQYXNzd29yZCIsIl9oYXNoZWRfcGFzc3dvcmQiLCJfdmFsaWRhdGVVc2VyTmFtZSIsIl92YWxpZGF0ZUVtYWlsIiwicmFuZG9tU3RyaW5nIiwicmVzcG9uc2VTaG91bGRIYXZlVXNlcm5hbWUiLCIkbmUiLCJsaW1pdCIsIlVTRVJOQU1FX1RBS0VOIiwiZW1haWwiLCJfX29wIiwibWF0Y2giLCJyZWplY3QiLCJJTlZBTElEX0VNQUlMX0FERFJFU1MiLCJFTUFJTF9UQUtFTiIsInVzZXJDb250cm9sbGVyIiwic2V0RW1haWxWZXJpZnlUb2tlbiIsInBhc3N3b3JkUG9saWN5IiwiX3ZhbGlkYXRlUGFzc3dvcmRSZXF1aXJlbWVudHMiLCJfdmFsaWRhdGVQYXNzd29yZEhpc3RvcnkiLCJwb2xpY3lFcnJvciIsInZhbGlkYXRpb25FcnJvciIsImNvbnRhaW5zVXNlcm5hbWVFcnJvciIsInBhdHRlcm5WYWxpZGF0b3IiLCJ2YWxpZGF0b3JDYWxsYmFjayIsIlZBTElEQVRJT05fRVJST1IiLCJkb05vdEFsbG93VXNlcm5hbWUiLCJtYXhQYXNzd29yZEhpc3RvcnkiLCJvbGRQYXNzd29yZHMiLCJfcGFzc3dvcmRfaGlzdG9yeSIsInRha2UiLCJuZXdQYXNzd29yZCIsInByb21pc2VzIiwiY29tcGFyZSIsImNhdGNoIiwiZXJyIiwicHJldmVudExvZ2luV2l0aFVudmVyaWZpZWRFbWFpbCIsInZlcmlmeVVzZXJFbWFpbHMiLCJjcmVhdGVTZXNzaW9uVG9rZW4iLCJpbnN0YWxsYXRpb25JZCIsInNlc3Npb25EYXRhIiwiY3JlYXRlU2Vzc2lvbiIsImNyZWF0ZWRXaXRoIiwiYWN0aW9uIiwiYXV0aFByb3ZpZGVyIiwiYWRkT3BzIiwiX3BlcmlzaGFibGVfdG9rZW4iLCJfcGVyaXNoYWJsZV90b2tlbl9leHBpcmVzX2F0IiwiYXNzaWduIiwiZGVzdHJveSIsInJldm9rZVNlc3Npb25PblBhc3N3b3JkUmVzZXQiLCJzZXNzaW9uUXVlcnkiLCJiaW5kIiwic2VuZFZlcmlmaWNhdGlvbkVtYWlsIiwiSU5WQUxJRF9TRVNTSU9OX1RPS0VOIiwiYWRkaXRpb25hbFNlc3Npb25EYXRhIiwiSU5URVJOQUxfU0VSVkVSX0VSUk9SIiwic3RhdHVzIiwiZGV2aWNlVG9rZW4iLCJ0b0xvd2VyQ2FzZSIsImRldmljZVR5cGUiLCJpZE1hdGNoIiwib2JqZWN0SWRNYXRjaCIsImluc3RhbGxhdGlvbklkTWF0Y2giLCJkZXZpY2VUb2tlbk1hdGNoZXMiLCJvclF1ZXJpZXMiLCJPQkpFQ1RfTk9UX0ZPVU5EIiwiZGVsUXVlcnkiLCJhcHBJZGVudGlmaWVyIiwiY29kZSIsIm9iaklkIiwiZmlsZXNDb250cm9sbGVyIiwiZXhwYW5kRmlsZXNJbk9iamVjdCIsInJvbGUiLCJjbGVhciIsImlzVW5hdXRoZW50aWNhdGVkIiwiU0VTU0lPTl9NSVNTSU5HIiwiZG93bmxvYWQiLCJkb3dubG9hZE5hbWUiLCJuYW1lIiwiSU5WQUxJRF9BQ0wiLCJyZWFkIiwid3JpdGUiLCJtYXhQYXNzd29yZEFnZSIsIl9wYXNzd29yZF9jaGFuZ2VkX2F0IiwiZGVmZXIiLCJzaGlmdCIsIl91cGRhdGVSZXNwb25zZVdpdGhEYXRhIiwiY3JlYXRlIiwiRFVQTElDQVRFX1ZBTFVFIiwidXNlckluZm8iLCJkdXBsaWNhdGVkX2ZpZWxkIiwiaGFzQWZ0ZXJTYXZlSG9vayIsImFmdGVyU2F2ZSIsImhhc0xpdmVRdWVyeSIsImxpdmVRdWVyeUNvbnRyb2xsZXIiLCJfaGFuZGxlU2F2ZVJlc3BvbnNlIiwicGVybXMiLCJnZXRDbGFzc0xldmVsUGVybWlzc2lvbnMiLCJvbkFmdGVyU2F2ZSIsImxvZ2dlciIsIndhcm4iLCJtaWRkbGUiLCJtb3VudCIsInNhbml0aXplZERhdGEiLCJ0ZXN0IiwiX2RlY29kZSIsInNwbGl0dGVkS2V5Iiwic3BsaXQiLCJwYXJlbnRQcm9wIiwicGFyZW50VmFsIiwiZ2V0Iiwic2V0IiwiY2xpZW50U3VwcG9ydHNEZWxldGUiLCJzdXBwb3J0c0ZvcndhcmREZWxldGUiLCJmaWVsZE5hbWUiLCJkYXRhVmFsdWUiLCJoYXNPd25Qcm9wZXJ0eSIsIm1vZHVsZSIsImV4cG9ydHMiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFhQTs7QUFDQTs7QUFDQTs7OztBQWZBO0FBQ0E7QUFDQTtBQUVBLElBQUlBLGdCQUFnQixHQUFHQyxPQUFPLENBQUMsZ0NBQUQsQ0FBOUI7O0FBQ0EsSUFBSUMsUUFBUSxHQUFHRCxPQUFPLENBQUMsVUFBRCxDQUF0Qjs7QUFFQSxNQUFNRSxJQUFJLEdBQUdGLE9BQU8sQ0FBQyxRQUFELENBQXBCOztBQUNBLElBQUlHLFdBQVcsR0FBR0gsT0FBTyxDQUFDLGVBQUQsQ0FBekI7O0FBQ0EsSUFBSUksY0FBYyxHQUFHSixPQUFPLENBQUMsWUFBRCxDQUE1Qjs7QUFDQSxJQUFJSyxLQUFLLEdBQUdMLE9BQU8sQ0FBQyxZQUFELENBQW5COztBQUNBLElBQUlNLFFBQVEsR0FBR04sT0FBTyxDQUFDLFlBQUQsQ0FBdEI7O0FBQ0EsSUFBSU8sU0FBUyxHQUFHUCxPQUFPLENBQUMsYUFBRCxDQUF2Qjs7QUFLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxTQUFTUSxTQUFULENBQ0VDLE1BREYsRUFFRUMsSUFGRixFQUdFQyxTQUhGLEVBSUVDLEtBSkYsRUFLRUMsSUFMRixFQU1FQyxZQU5GLEVBT0VDLFNBUEYsRUFRRTtBQUNBLE1BQUlMLElBQUksQ0FBQ00sVUFBVCxFQUFxQjtBQUNuQixVQUFNLElBQUlYLEtBQUssQ0FBQ1ksS0FBVixDQUNKWixL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QUFDbEQsV0FBT3JELFFBQVA7QUFDRDs7QUFDRCxRQUFNNE8sb0JBQW9CLEdBQUc3UCxTQUFTLENBQUM4UCxxQkFBVixDQUFnQyxLQUFLdFAsU0FBckMsQ0FBN0I7QUFDQSxPQUFLSSxPQUFMLENBQWEwRCxzQkFBYixDQUFvQ21ELE9BQXBDLENBQTRDc0ksU0FBUyxJQUFJO0FBQ3ZELFVBQU1DLFNBQVMsR0FBRzFQLElBQUksQ0FBQ3lQLFNBQUQsQ0FBdEI7O0FBRUEsUUFBSSxDQUFDOU8sUUFBUSxDQUFDZ1AsY0FBVCxDQUF3QkYsU0FBeEIsQ0FBTCxFQUF5QztBQUN2QzlPLE1BQUFBLFFBQVEsQ0FBQzhPLFNBQUQsQ0FBUixHQUFzQkMsU0FBdEI7QUFDRCxLQUxzRCxDQU92RDs7O0FBQ0EsUUFBSS9PLFFBQVEsQ0FBQzhPLFNBQUQsQ0FBUixJQUF1QjlPLFFBQVEsQ0FBQzhPLFNBQUQsQ0FBUixDQUFvQnpHLElBQS9DLEVBQXFEO0FBQ25ELGFBQU9ySSxRQUFRLENBQUM4TyxTQUFELENBQWY7O0FBQ0EsVUFBSUYsb0JBQW9CLElBQUlHLFNBQVMsQ0FBQzFHLElBQVYsSUFBa0IsUUFBOUMsRUFBd0Q7QUFDdERySSxRQUFBQSxRQUFRLENBQUM4TyxTQUFELENBQVIsR0FBc0JDLFNBQXRCO0FBQ0Q7QUFDRjtBQUNGLEdBZEQ7QUFlQSxTQUFPL08sUUFBUDtBQUNELENBckJEOztlQXVCZWhCLFM7O0FBQ2ZpUSxNQUFNLENBQUNDLE9BQVAsR0FBaUJsUSxTQUFqQiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEEgUmVzdFdyaXRlIGVuY2Fwc3VsYXRlcyBldmVyeXRoaW5nIHdlIG5lZWQgdG8gcnVuIGFuIG9wZXJhdGlvblxuLy8gdGhhdCB3cml0ZXMgdG8gdGhlIGRhdGFiYXNlLlxuLy8gVGhpcyBjb3VsZCBiZSBlaXRoZXIgYSBcImNyZWF0ZVwiIG9yIGFuIFwidXBkYXRlXCIuXG5cbnZhciBTY2hlbWFDb250cm9sbGVyID0gcmVxdWlyZSgnLi9Db250cm9sbGVycy9TY2hlbWFDb250cm9sbGVyJyk7XG52YXIgZGVlcGNvcHkgPSByZXF1aXJlKCdkZWVwY29weScpO1xuXG5jb25zdCBBdXRoID0gcmVxdWlyZSgnLi9BdXRoJyk7XG52YXIgY3J5cHRvVXRpbHMgPSByZXF1aXJlKCcuL2NyeXB0b1V0aWxzJyk7XG52YXIgcGFzc3dvcmRDcnlwdG8gPSByZXF1aXJlKCcuL3Bhc3N3b3JkJyk7XG52YXIgUGFyc2UgPSByZXF1aXJlKCdwYXJzZS9ub2RlJyk7XG52YXIgdHJpZ2dlcnMgPSByZXF1aXJlKCcuL3RyaWdnZXJzJyk7XG52YXIgQ2xpZW50U0RLID0gcmVxdWlyZSgnLi9DbGllbnRTREsnKTtcbmltcG9ydCBSZXN0UXVlcnkgZnJvbSAnLi9SZXN0UXVlcnknO1xuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJztcbmltcG9ydCBsb2dnZXIgZnJvbSAnLi9sb2dnZXInO1xuXG4vLyBxdWVyeSBhbmQgZGF0YSBhcmUgYm90aCBwcm92aWRlZCBpbiBSRVNUIEFQSSBmb3JtYXQuIFNvIGRhdGFcbi8vIHR5cGVzIGFyZSBlbmNvZGVkIGJ5IHBsYWluIG9sZCBvYmplY3RzLlxuLy8gSWYgcXVlcnkgaXMgbnVsbCwgdGhpcyBpcyBhIFwiY3JlYXRlXCIgYW5kIHRoZSBkYXRhIGluIGRhdGEgc2hvdWxkIGJlXG4vLyBjcmVhdGVkLlxuLy8gT3RoZXJ3aXNlIHRoaXMgaXMgYW4gXCJ1cGRhdGVcIiAtIHRoZSBvYmplY3QgbWF0Y2hpbmcgdGhlIHF1ZXJ5XG4vLyBzaG91bGQgZ2V0IHVwZGF0ZWQgd2l0aCBkYXRhLlxuLy8gUmVzdFdyaXRlIHdpbGwgaGFuZGxlIG9iamVjdElkLCBjcmVhdGVkQXQsIGFuZCB1cGRhdGVkQXQgZm9yXG4vLyBldmVyeXRoaW5nLiBJdCBhbHNvIGtub3dzIHRvIHVzZSB0cmlnZ2VycyBhbmQgc3BlY2lhbCBtb2RpZmljYXRpb25zXG4vLyBmb3IgdGhlIF9Vc2VyIGNsYXNzLlxuZnVuY3Rpb24gUmVzdFdyaXRlKFxuICBjb25maWcsXG4gIGF1dGgsXG4gIGNsYXNzTmFtZSxcbiAgcXVlcnksXG4gIGRhdGEsXG4gIG9yaWdpbmFsRGF0YSxcbiAgY2xpZW50U0RLXG4pIHtcbiAgaWYgKGF1dGguaXNSZWFkT25seSkge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLk9QRVJBVElPTl9GT1JCSURERU4sXG4gICAgICAnQ2Fubm90IHBlcmZvcm0gYSB3cml0ZSBvcGVyYXRpb24gd2hlbiB1c2luZyByZWFkT25seU1hc3RlcktleSdcbiAgICApO1xuICB9XG4gIHRoaXMuY29uZmlnID0gY29uZmlnO1xuICB0aGlzLmF1dGggPSBhdXRoO1xuICB0aGlzLmNsYXNzTmFtZSA9IGNsYXNzTmFtZTtcbiAgdGhpcy5jbGllbnRTREsgPSBjbGllbnRTREs7XG4gIHRoaXMuc3RvcmFnZSA9IHt9O1xuICB0aGlzLnJ1bk9wdGlvbnMgPSB7fTtcbiAgdGhpcy5jb250ZXh0ID0ge307XG4gIGlmICghcXVlcnkgJiYgZGF0YS5vYmplY3RJZCkge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUsXG4gICAgICAnb2JqZWN0SWQgaXMgYW4gaW52YWxpZCBmaWVsZCBuYW1lLidcbiAgICApO1xuICB9XG5cbiAgLy8gV2hlbiB0aGUgb3BlcmF0aW9uIGlzIGNvbXBsZXRlLCB0aGlzLnJlc3BvbnNlIG1heSBoYXZlIHNldmVyYWxcbiAgLy8gZmllbGRzLlxuICAvLyByZXNwb25zZTogdGhlIGFjdHVhbCBkYXRhIHRvIGJlIHJldHVybmVkXG4gIC8vIHN0YXR1czogdGhlIGh0dHAgc3RhdHVzIGNvZGUuIGlmIG5vdCBwcmVzZW50LCB0cmVhdGVkIGxpa2UgYSAyMDBcbiAgLy8gbG9jYXRpb246IHRoZSBsb2NhdGlvbiBoZWFkZXIuIGlmIG5vdCBwcmVzZW50LCBubyBsb2NhdGlvbiBoZWFkZXJcbiAgdGhpcy5yZXNwb25zZSA9IG51bGw7XG5cbiAgLy8gUHJvY2Vzc2luZyB0aGlzIG9wZXJhdGlvbiBtYXkgbXV0YXRlIG91ciBkYXRhLCBzbyB3ZSBvcGVyYXRlIG9uIGFcbiAgLy8gY29weVxuICB0aGlzLnF1ZXJ5ID0gZGVlcGNvcHkocXVlcnkpO1xuICB0aGlzLmRhdGEgPSBkZWVwY29weShkYXRhKTtcbiAgLy8gV2UgbmV2ZXIgY2hhbmdlIG9yaWdpbmFsRGF0YSwgc28gd2UgZG8gbm90IG5lZWQgYSBkZWVwIGNvcHlcbiAgdGhpcy5vcmlnaW5hbERhdGEgPSBvcmlnaW5hbERhdGE7XG5cbiAgLy8gVGhlIHRpbWVzdGFtcCB3ZSdsbCB1c2UgZm9yIHRoaXMgd2hvbGUgb3BlcmF0aW9uXG4gIHRoaXMudXBkYXRlZEF0ID0gUGFyc2UuX2VuY29kZShuZXcgRGF0ZSgpKS5pc287XG59XG5cbi8vIEEgY29udmVuaWVudCBtZXRob2QgdG8gcGVyZm9ybSBhbGwgdGhlIHN0ZXBzIG9mIHByb2Nlc3NpbmcgdGhlXG4vLyB3cml0ZSwgaW4gb3JkZXIuXG4vLyBSZXR1cm5zIGEgcHJvbWlzZSBmb3IgYSB7cmVzcG9uc2UsIHN0YXR1cywgbG9jYXRpb259IG9iamVjdC5cbi8vIHN0YXR1cyBhbmQgbG9jYXRpb24gYXJlIG9wdGlvbmFsLlxuUmVzdFdyaXRlLnByb3RvdHlwZS5leGVjdXRlID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBQcm9taXNlLnJlc29sdmUoKVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmdldFVzZXJBbmRSb2xlQUNMKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy52YWxpZGF0ZUNsaWVudENsYXNzQ3JlYXRpb24oKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmhhbmRsZUluc3RhbGxhdGlvbigpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlU2Vzc2lvbigpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMudmFsaWRhdGVBdXRoRGF0YSgpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMucnVuQmVmb3JlVHJpZ2dlcigpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuZGVsZXRlRW1haWxSZXNldFRva2VuSWZOZWVkZWQoKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLnZhbGlkYXRlU2NoZW1hKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5zZXRSZXF1aXJlZEZpZWxkc0lmTmVlZGVkKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy50cmFuc2Zvcm1Vc2VyKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5leHBhbmRGaWxlc0ZvckV4aXN0aW5nT2JqZWN0cygpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuZGVzdHJveUR1cGxpY2F0ZWRTZXNzaW9ucygpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMucnVuRGF0YWJhc2VPcGVyYXRpb24oKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVNlc3Npb25Ub2tlbklmTmVlZGVkKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVGb2xsb3d1cCgpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMucnVuQWZ0ZXJUcmlnZ2VyKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5jbGVhblVzZXJBdXRoRGF0YSgpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMucmVzcG9uc2U7XG4gICAgfSk7XG59O1xuXG4vLyBVc2VzIHRoZSBBdXRoIG9iamVjdCB0byBnZXQgdGhlIGxpc3Qgb2Ygcm9sZXMsIGFkZHMgdGhlIHVzZXIgaWRcblJlc3RXcml0ZS5wcm90b3R5cGUuZ2V0VXNlckFuZFJvbGVBQ0wgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMuYXV0aC5pc01hc3Rlcikge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIHRoaXMucnVuT3B0aW9ucy5hY2wgPSBbJyonXTtcblxuICBpZiAodGhpcy5hdXRoLnVzZXIpIHtcbiAgICByZXR1cm4gdGhpcy5hdXRoLmdldFVzZXJSb2xlcygpLnRoZW4ocm9sZXMgPT4ge1xuICAgICAgdGhpcy5ydW5PcHRpb25zLmFjbCA9IHRoaXMucnVuT3B0aW9ucy5hY2wuY29uY2F0KHJvbGVzLCBbXG4gICAgICAgIHRoaXMuYXV0aC51c2VyLmlkLFxuICAgICAgXSk7XG4gICAgICByZXR1cm47XG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG59O1xuXG4vLyBWYWxpZGF0ZXMgdGhpcyBvcGVyYXRpb24gYWdhaW5zdCB0aGUgYWxsb3dDbGllbnRDbGFzc0NyZWF0aW9uIGNvbmZpZy5cblJlc3RXcml0ZS5wcm90b3R5cGUudmFsaWRhdGVDbGllbnRDbGFzc0NyZWF0aW9uID0gZnVuY3Rpb24oKSB7XG4gIGlmIChcbiAgICB0aGlzLmNvbmZpZy5hbGxvd0NsaWVudENsYXNzQ3JlYXRpb24gPT09IGZhbHNlICYmXG4gICAgIXRoaXMuYXV0aC5pc01hc3RlciAmJlxuICAgIFNjaGVtYUNvbnRyb2xsZXIuc3lzdGVtQ2xhc3Nlcy5pbmRleE9mKHRoaXMuY2xhc3NOYW1lKSA9PT0gLTFcbiAgKSB7XG4gICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlXG4gICAgICAubG9hZFNjaGVtYSgpXG4gICAgICAudGhlbihzY2hlbWFDb250cm9sbGVyID0+IHNjaGVtYUNvbnRyb2xsZXIuaGFzQ2xhc3ModGhpcy5jbGFzc05hbWUpKVxuICAgICAgLnRoZW4oaGFzQ2xhc3MgPT4ge1xuICAgICAgICBpZiAoaGFzQ2xhc3MgIT09IHRydWUpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5PUEVSQVRJT05fRk9SQklEREVOLFxuICAgICAgICAgICAgJ1RoaXMgdXNlciBpcyBub3QgYWxsb3dlZCB0byBhY2Nlc3MgJyArXG4gICAgICAgICAgICAgICdub24tZXhpc3RlbnQgY2xhc3M6ICcgK1xuICAgICAgICAgICAgICB0aGlzLmNsYXNzTmFtZVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxufTtcblxuLy8gVmFsaWRhdGVzIHRoaXMgb3BlcmF0aW9uIGFnYWluc3QgdGhlIHNjaGVtYS5cblJlc3RXcml0ZS5wcm90b3R5cGUudmFsaWRhdGVTY2hlbWEgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlLnZhbGlkYXRlT2JqZWN0KFxuICAgIHRoaXMuY2xhc3NOYW1lLFxuICAgIHRoaXMuZGF0YSxcbiAgICB0aGlzLnF1ZXJ5LFxuICAgIHRoaXMucnVuT3B0aW9uc1xuICApO1xufTtcblxuLy8gUnVucyBhbnkgYmVmb3JlU2F2ZSB0cmlnZ2VycyBhZ2FpbnN0IHRoaXMgb3BlcmF0aW9uLlxuLy8gQW55IGNoYW5nZSBsZWFkcyB0byBvdXIgZGF0YSBiZWluZyBtdXRhdGVkLlxuUmVzdFdyaXRlLnByb3RvdHlwZS5ydW5CZWZvcmVUcmlnZ2VyID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLnJlc3BvbnNlKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gQXZvaWQgZG9pbmcgYW55IHNldHVwIGZvciB0cmlnZ2VycyBpZiB0aGVyZSBpcyBubyAnYmVmb3JlU2F2ZScgdHJpZ2dlciBmb3IgdGhpcyBjbGFzcy5cbiAgaWYgKFxuICAgICF0cmlnZ2Vycy50cmlnZ2VyRXhpc3RzKFxuICAgICAgdGhpcy5jbGFzc05hbWUsXG4gICAgICB0cmlnZ2Vycy5UeXBlcy5iZWZvcmVTYXZlLFxuICAgICAgdGhpcy5jb25maWcuYXBwbGljYXRpb25JZFxuICAgIClcbiAgKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgLy8gQ2xvdWQgY29kZSBnZXRzIGEgYml0IG9mIGV4dHJhIGRhdGEgZm9yIGl0cyBvYmplY3RzXG4gIHZhciBleHRyYURhdGEgPSB7IGNsYXNzTmFtZTogdGhpcy5jbGFzc05hbWUgfTtcbiAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5xdWVyeS5vYmplY3RJZCkge1xuICAgIGV4dHJhRGF0YS5vYmplY3RJZCA9IHRoaXMucXVlcnkub2JqZWN0SWQ7XG4gIH1cblxuICBsZXQgb3JpZ2luYWxPYmplY3QgPSBudWxsO1xuICBjb25zdCB1cGRhdGVkT2JqZWN0ID0gdGhpcy5idWlsZFVwZGF0ZWRPYmplY3QoZXh0cmFEYXRhKTtcbiAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5xdWVyeS5vYmplY3RJZCkge1xuICAgIC8vIFRoaXMgaXMgYW4gdXBkYXRlIGZvciBleGlzdGluZyBvYmplY3QuXG4gICAgb3JpZ2luYWxPYmplY3QgPSB0cmlnZ2Vycy5pbmZsYXRlKGV4dHJhRGF0YSwgdGhpcy5vcmlnaW5hbERhdGEpO1xuICB9XG5cbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRyaWdnZXJzLm1heWJlUnVuVHJpZ2dlcihcbiAgICAgICAgdHJpZ2dlcnMuVHlwZXMuYmVmb3JlU2F2ZSxcbiAgICAgICAgdGhpcy5hdXRoLFxuICAgICAgICB1cGRhdGVkT2JqZWN0LFxuICAgICAgICBvcmlnaW5hbE9iamVjdCxcbiAgICAgICAgdGhpcy5jb25maWcsXG4gICAgICAgIHRoaXMuY29udGV4dFxuICAgICAgKTtcbiAgICB9KVxuICAgIC50aGVuKHJlc3BvbnNlID0+IHtcbiAgICAgIGlmIChyZXNwb25zZSAmJiByZXNwb25zZS5vYmplY3QpIHtcbiAgICAgICAgdGhpcy5zdG9yYWdlLmZpZWxkc0NoYW5nZWRCeVRyaWdnZXIgPSBfLnJlZHVjZShcbiAgICAgICAgICByZXNwb25zZS5vYmplY3QsXG4gICAgICAgICAgKHJlc3VsdCwgdmFsdWUsIGtleSkgPT4ge1xuICAgICAgICAgICAgaWYgKCFfLmlzRXF1YWwodGhpcy5kYXRhW2tleV0sIHZhbHVlKSkge1xuICAgICAgICAgICAgICByZXN1bHQucHVzaChrZXkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgICB9LFxuICAgICAgICAgIFtdXG4gICAgICAgICk7XG4gICAgICAgIHRoaXMuZGF0YSA9IHJlc3BvbnNlLm9iamVjdDtcbiAgICAgICAgLy8gV2Ugc2hvdWxkIGRlbGV0ZSB0aGUgb2JqZWN0SWQgZm9yIGFuIHVwZGF0ZSB3cml0ZVxuICAgICAgICBpZiAodGhpcy5xdWVyeSAmJiB0aGlzLnF1ZXJ5Lm9iamVjdElkKSB7XG4gICAgICAgICAgZGVsZXRlIHRoaXMuZGF0YS5vYmplY3RJZDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5zZXRSZXF1aXJlZEZpZWxkc0lmTmVlZGVkID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLmRhdGEpIHtcbiAgICAvLyBBZGQgZGVmYXVsdCBmaWVsZHNcbiAgICB0aGlzLmRhdGEudXBkYXRlZEF0ID0gdGhpcy51cGRhdGVkQXQ7XG4gICAgaWYgKCF0aGlzLnF1ZXJ5KSB7XG4gICAgICB0aGlzLmRhdGEuY3JlYXRlZEF0ID0gdGhpcy51cGRhdGVkQXQ7XG5cbiAgICAgIC8vIE9ubHkgYXNzaWduIG5ldyBvYmplY3RJZCBpZiB3ZSBhcmUgY3JlYXRpbmcgbmV3IG9iamVjdFxuICAgICAgaWYgKCF0aGlzLmRhdGEub2JqZWN0SWQpIHtcbiAgICAgICAgdGhpcy5kYXRhLm9iamVjdElkID0gY3J5cHRvVXRpbHMubmV3T2JqZWN0SWQodGhpcy5jb25maWcub2JqZWN0SWRTaXplKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xufTtcblxuLy8gVHJhbnNmb3JtcyBhdXRoIGRhdGEgZm9yIGEgdXNlciBvYmplY3QuXG4vLyBEb2VzIG5vdGhpbmcgaWYgdGhpcyBpc24ndCBhIHVzZXIgb2JqZWN0LlxuLy8gUmV0dXJucyBhIHByb21pc2UgZm9yIHdoZW4gd2UncmUgZG9uZSBpZiBpdCBjYW4ndCBmaW5pc2ggdGhpcyB0aWNrLlxuUmVzdFdyaXRlLnByb3RvdHlwZS52YWxpZGF0ZUF1dGhEYXRhID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLmNsYXNzTmFtZSAhPT0gJ19Vc2VyJykge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICghdGhpcy5xdWVyeSAmJiAhdGhpcy5kYXRhLmF1dGhEYXRhKSB7XG4gICAgaWYgKFxuICAgICAgdHlwZW9mIHRoaXMuZGF0YS51c2VybmFtZSAhPT0gJ3N0cmluZycgfHxcbiAgICAgIF8uaXNFbXB0eSh0aGlzLmRhdGEudXNlcm5hbWUpXG4gICAgKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLlVTRVJOQU1FX01JU1NJTkcsXG4gICAgICAgICdiYWQgb3IgbWlzc2luZyB1c2VybmFtZSdcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIHR5cGVvZiB0aGlzLmRhdGEucGFzc3dvcmQgIT09ICdzdHJpbmcnIHx8XG4gICAgICBfLmlzRW1wdHkodGhpcy5kYXRhLnBhc3N3b3JkKVxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5QQVNTV09SRF9NSVNTSU5HLFxuICAgICAgICAncGFzc3dvcmQgaXMgcmVxdWlyZWQnXG4gICAgICApO1xuICAgIH1cbiAgfVxuXG4gIGlmICghdGhpcy5kYXRhLmF1dGhEYXRhIHx8ICFPYmplY3Qua2V5cyh0aGlzLmRhdGEuYXV0aERhdGEpLmxlbmd0aCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHZhciBhdXRoRGF0YSA9IHRoaXMuZGF0YS5hdXRoRGF0YTtcbiAgdmFyIHByb3ZpZGVycyA9IE9iamVjdC5rZXlzKGF1dGhEYXRhKTtcbiAgaWYgKHByb3ZpZGVycy5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QgY2FuSGFuZGxlQXV0aERhdGEgPSBwcm92aWRlcnMucmVkdWNlKChjYW5IYW5kbGUsIHByb3ZpZGVyKSA9PiB7XG4gICAgICB2YXIgcHJvdmlkZXJBdXRoRGF0YSA9IGF1dGhEYXRhW3Byb3ZpZGVyXTtcbiAgICAgIHZhciBoYXNUb2tlbiA9IHByb3ZpZGVyQXV0aERhdGEgJiYgcHJvdmlkZXJBdXRoRGF0YS5pZDtcbiAgICAgIHJldHVybiBjYW5IYW5kbGUgJiYgKGhhc1Rva2VuIHx8IHByb3ZpZGVyQXV0aERhdGEgPT0gbnVsbCk7XG4gICAgfSwgdHJ1ZSk7XG4gICAgaWYgKGNhbkhhbmRsZUF1dGhEYXRhKSB7XG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVBdXRoRGF0YShhdXRoRGF0YSk7XG4gICAgfVxuICB9XG4gIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICBQYXJzZS5FcnJvci5VTlNVUFBPUlRFRF9TRVJWSUNFLFxuICAgICdUaGlzIGF1dGhlbnRpY2F0aW9uIG1ldGhvZCBpcyB1bnN1cHBvcnRlZC4nXG4gICk7XG59O1xuXG5SZXN0V3JpdGUucHJvdG90eXBlLmhhbmRsZUF1dGhEYXRhVmFsaWRhdGlvbiA9IGZ1bmN0aW9uKGF1dGhEYXRhKSB7XG4gIGNvbnN0IHZhbGlkYXRpb25zID0gT2JqZWN0LmtleXMoYXV0aERhdGEpLm1hcChwcm92aWRlciA9PiB7XG4gICAgaWYgKGF1dGhEYXRhW3Byb3ZpZGVyXSA9PT0gbnVsbCkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cbiAgICBjb25zdCB2YWxpZGF0ZUF1dGhEYXRhID0gdGhpcy5jb25maWcuYXV0aERhdGFNYW5hZ2VyLmdldFZhbGlkYXRvckZvclByb3ZpZGVyKFxuICAgICAgcHJvdmlkZXJcbiAgICApO1xuICAgIGlmICghdmFsaWRhdGVBdXRoRGF0YSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5VTlNVUFBPUlRFRF9TRVJWSUNFLFxuICAgICAgICAnVGhpcyBhdXRoZW50aWNhdGlvbiBtZXRob2QgaXMgdW5zdXBwb3J0ZWQuJ1xuICAgICAgKTtcbiAgICB9XG4gICAgcmV0dXJuIHZhbGlkYXRlQXV0aERhdGEoYXV0aERhdGFbcHJvdmlkZXJdKTtcbiAgfSk7XG4gIHJldHVybiBQcm9taXNlLmFsbCh2YWxpZGF0aW9ucyk7XG59O1xuXG5SZXN0V3JpdGUucHJvdG90eXBlLmZpbmRVc2Vyc1dpdGhBdXRoRGF0YSA9IGZ1bmN0aW9uKGF1dGhEYXRhKSB7XG4gIGNvbnN0IHByb3ZpZGVycyA9IE9iamVjdC5rZXlzKGF1dGhEYXRhKTtcbiAgY29uc3QgcXVlcnkgPSBwcm92aWRlcnNcbiAgICAucmVkdWNlKChtZW1vLCBwcm92aWRlcikgPT4ge1xuICAgICAgaWYgKCFhdXRoRGF0YVtwcm92aWRlcl0pIHtcbiAgICAgICAgcmV0dXJuIG1lbW87XG4gICAgICB9XG4gICAgICBjb25zdCBxdWVyeUtleSA9IGBhdXRoRGF0YS4ke3Byb3ZpZGVyfS5pZGA7XG4gICAgICBjb25zdCBxdWVyeSA9IHt9O1xuICAgICAgcXVlcnlbcXVlcnlLZXldID0gYXV0aERhdGFbcHJvdmlkZXJdLmlkO1xuICAgICAgbWVtby5wdXNoKHF1ZXJ5KTtcbiAgICAgIHJldHVybiBtZW1vO1xuICAgIH0sIFtdKVxuICAgIC5maWx0ZXIocSA9PiB7XG4gICAgICByZXR1cm4gdHlwZW9mIHEgIT09ICd1bmRlZmluZWQnO1xuICAgIH0pO1xuXG4gIGxldCBmaW5kUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZShbXSk7XG4gIGlmIChxdWVyeS5sZW5ndGggPiAwKSB7XG4gICAgZmluZFByb21pc2UgPSB0aGlzLmNvbmZpZy5kYXRhYmFzZS5maW5kKHRoaXMuY2xhc3NOYW1lLCB7ICRvcjogcXVlcnkgfSwge30pO1xuICB9XG5cbiAgcmV0dXJuIGZpbmRQcm9taXNlO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5maWx0ZXJlZE9iamVjdHNCeUFDTCA9IGZ1bmN0aW9uKG9iamVjdHMpIHtcbiAgaWYgKHRoaXMuYXV0aC5pc01hc3Rlcikge1xuICAgIHJldHVybiBvYmplY3RzO1xuICB9XG4gIHJldHVybiBvYmplY3RzLmZpbHRlcihvYmplY3QgPT4ge1xuICAgIGlmICghb2JqZWN0LkFDTCkge1xuICAgICAgcmV0dXJuIHRydWU7IC8vIGxlZ2FjeSB1c2VycyB0aGF0IGhhdmUgbm8gQUNMIGZpZWxkIG9uIHRoZW1cbiAgICB9XG4gICAgLy8gUmVndWxhciB1c2VycyB0aGF0IGhhdmUgYmVlbiBsb2NrZWQgb3V0LlxuICAgIHJldHVybiBvYmplY3QuQUNMICYmIE9iamVjdC5rZXlzKG9iamVjdC5BQ0wpLmxlbmd0aCA+IDA7XG4gIH0pO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5oYW5kbGVBdXRoRGF0YSA9IGZ1bmN0aW9uKGF1dGhEYXRhKSB7XG4gIGxldCByZXN1bHRzO1xuICByZXR1cm4gdGhpcy5maW5kVXNlcnNXaXRoQXV0aERhdGEoYXV0aERhdGEpLnRoZW4ociA9PiB7XG4gICAgcmVzdWx0cyA9IHRoaXMuZmlsdGVyZWRPYmplY3RzQnlBQ0wocik7XG4gICAgaWYgKHJlc3VsdHMubGVuZ3RoID4gMSkge1xuICAgICAgLy8gTW9yZSB0aGFuIDEgdXNlciB3aXRoIHRoZSBwYXNzZWQgaWQnc1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5BQ0NPVU5UX0FMUkVBRFlfTElOS0VELFxuICAgICAgICAndGhpcyBhdXRoIGlzIGFscmVhZHkgdXNlZCdcbiAgICAgICk7XG4gICAgfVxuXG4gICAgdGhpcy5zdG9yYWdlWydhdXRoUHJvdmlkZXInXSA9IE9iamVjdC5rZXlzKGF1dGhEYXRhKS5qb2luKCcsJyk7XG5cbiAgICBpZiAocmVzdWx0cy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCB1c2VyUmVzdWx0ID0gcmVzdWx0c1swXTtcbiAgICAgIGNvbnN0IG11dGF0ZWRBdXRoRGF0YSA9IHt9O1xuICAgICAgT2JqZWN0LmtleXMoYXV0aERhdGEpLmZvckVhY2gocHJvdmlkZXIgPT4ge1xuICAgICAgICBjb25zdCBwcm92aWRlckRhdGEgPSBhdXRoRGF0YVtwcm92aWRlcl07XG4gICAgICAgIGNvbnN0IHVzZXJBdXRoRGF0YSA9IHVzZXJSZXN1bHQuYXV0aERhdGFbcHJvdmlkZXJdO1xuICAgICAgICBpZiAoIV8uaXNFcXVhbChwcm92aWRlckRhdGEsIHVzZXJBdXRoRGF0YSkpIHtcbiAgICAgICAgICBtdXRhdGVkQXV0aERhdGFbcHJvdmlkZXJdID0gcHJvdmlkZXJEYXRhO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGNvbnN0IGhhc011dGF0ZWRBdXRoRGF0YSA9IE9iamVjdC5rZXlzKG11dGF0ZWRBdXRoRGF0YSkubGVuZ3RoICE9PSAwO1xuICAgICAgbGV0IHVzZXJJZDtcbiAgICAgIGlmICh0aGlzLnF1ZXJ5ICYmIHRoaXMucXVlcnkub2JqZWN0SWQpIHtcbiAgICAgICAgdXNlcklkID0gdGhpcy5xdWVyeS5vYmplY3RJZDtcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5hdXRoICYmIHRoaXMuYXV0aC51c2VyICYmIHRoaXMuYXV0aC51c2VyLmlkKSB7XG4gICAgICAgIHVzZXJJZCA9IHRoaXMuYXV0aC51c2VyLmlkO1xuICAgICAgfVxuICAgICAgaWYgKCF1c2VySWQgfHwgdXNlcklkID09PSB1c2VyUmVzdWx0Lm9iamVjdElkKSB7XG4gICAgICAgIC8vIG5vIHVzZXIgbWFraW5nIHRoZSBjYWxsXG4gICAgICAgIC8vIE9SIHRoZSB1c2VyIG1ha2luZyB0aGUgY2FsbCBpcyB0aGUgcmlnaHQgb25lXG4gICAgICAgIC8vIExvZ2luIHdpdGggYXV0aCBkYXRhXG4gICAgICAgIGRlbGV0ZSByZXN1bHRzWzBdLnBhc3N3b3JkO1xuXG4gICAgICAgIC8vIG5lZWQgdG8gc2V0IHRoZSBvYmplY3RJZCBmaXJzdCBvdGhlcndpc2UgbG9jYXRpb24gaGFzIHRyYWlsaW5nIHVuZGVmaW5lZFxuICAgICAgICB0aGlzLmRhdGEub2JqZWN0SWQgPSB1c2VyUmVzdWx0Lm9iamVjdElkO1xuXG4gICAgICAgIGlmICghdGhpcy5xdWVyeSB8fCAhdGhpcy5xdWVyeS5vYmplY3RJZCkge1xuICAgICAgICAgIC8vIHRoaXMgYSBsb2dpbiBjYWxsLCBubyB1c2VySWQgcGFzc2VkXG4gICAgICAgICAgdGhpcy5yZXNwb25zZSA9IHtcbiAgICAgICAgICAgIHJlc3BvbnNlOiB1c2VyUmVzdWx0LFxuICAgICAgICAgICAgbG9jYXRpb246IHRoaXMubG9jYXRpb24oKSxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIC8vIElmIHdlIGRpZG4ndCBjaGFuZ2UgdGhlIGF1dGggZGF0YSwganVzdCBrZWVwIGdvaW5nXG4gICAgICAgIGlmICghaGFzTXV0YXRlZEF1dGhEYXRhKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIC8vIFdlIGhhdmUgYXV0aERhdGEgdGhhdCBpcyB1cGRhdGVkIG9uIGxvZ2luXG4gICAgICAgIC8vIHRoYXQgY2FuIGhhcHBlbiB3aGVuIHRva2VuIGFyZSByZWZyZXNoZWQsXG4gICAgICAgIC8vIFdlIHNob3VsZCB1cGRhdGUgdGhlIHRva2VuIGFuZCBsZXQgdGhlIHVzZXIgaW5cbiAgICAgICAgLy8gV2Ugc2hvdWxkIG9ubHkgY2hlY2sgdGhlIG11dGF0ZWQga2V5c1xuICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVBdXRoRGF0YVZhbGlkYXRpb24obXV0YXRlZEF1dGhEYXRhKS50aGVuKCgpID0+IHtcbiAgICAgICAgICAvLyBJRiB3ZSBoYXZlIGEgcmVzcG9uc2UsIHdlJ2xsIHNraXAgdGhlIGRhdGFiYXNlIG9wZXJhdGlvbiAvIGJlZm9yZVNhdmUgLyBhZnRlclNhdmUgZXRjLi4uXG4gICAgICAgICAgLy8gd2UgbmVlZCB0byBzZXQgaXQgdXAgdGhlcmUuXG4gICAgICAgICAgLy8gV2UgYXJlIHN1cHBvc2VkIHRvIGhhdmUgYSByZXNwb25zZSBvbmx5IG9uIExPR0lOIHdpdGggYXV0aERhdGEsIHNvIHdlIHNraXAgdGhvc2VcbiAgICAgICAgICAvLyBJZiB3ZSdyZSBub3QgbG9nZ2luZyBpbiwgYnV0IGp1c3QgdXBkYXRpbmcgdGhlIGN1cnJlbnQgdXNlciwgd2UgY2FuIHNhZmVseSBza2lwIHRoYXQgcGFydFxuICAgICAgICAgIGlmICh0aGlzLnJlc3BvbnNlKSB7XG4gICAgICAgICAgICAvLyBBc3NpZ24gdGhlIG5ldyBhdXRoRGF0YSBpbiB0aGUgcmVzcG9uc2VcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKG11dGF0ZWRBdXRoRGF0YSkuZm9yRWFjaChwcm92aWRlciA9PiB7XG4gICAgICAgICAgICAgIHRoaXMucmVzcG9uc2UucmVzcG9uc2UuYXV0aERhdGFbcHJvdmlkZXJdID1cbiAgICAgICAgICAgICAgICBtdXRhdGVkQXV0aERhdGFbcHJvdmlkZXJdO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAvLyBSdW4gdGhlIERCIHVwZGF0ZSBkaXJlY3RseSwgYXMgJ21hc3RlcidcbiAgICAgICAgICAgIC8vIEp1c3QgdXBkYXRlIHRoZSBhdXRoRGF0YSBwYXJ0XG4gICAgICAgICAgICAvLyBUaGVuIHdlJ3JlIGdvb2QgZm9yIHRoZSB1c2VyLCBlYXJseSBleGl0IG9mIHNvcnRzXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UudXBkYXRlKFxuICAgICAgICAgICAgICB0aGlzLmNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgeyBvYmplY3RJZDogdGhpcy5kYXRhLm9iamVjdElkIH0sXG4gICAgICAgICAgICAgIHsgYXV0aERhdGE6IG11dGF0ZWRBdXRoRGF0YSB9LFxuICAgICAgICAgICAgICB7fVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIGlmICh1c2VySWQpIHtcbiAgICAgICAgLy8gVHJ5aW5nIHRvIHVwZGF0ZSBhdXRoIGRhdGEgYnV0IHVzZXJzXG4gICAgICAgIC8vIGFyZSBkaWZmZXJlbnRcbiAgICAgICAgaWYgKHVzZXJSZXN1bHQub2JqZWN0SWQgIT09IHVzZXJJZCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLkFDQ09VTlRfQUxSRUFEWV9MSU5LRUQsXG4gICAgICAgICAgICAndGhpcyBhdXRoIGlzIGFscmVhZHkgdXNlZCdcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIC8vIE5vIGF1dGggZGF0YSB3YXMgbXV0YXRlZCwganVzdCBrZWVwIGdvaW5nXG4gICAgICAgIGlmICghaGFzTXV0YXRlZEF1dGhEYXRhKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmhhbmRsZUF1dGhEYXRhVmFsaWRhdGlvbihhdXRoRGF0YSk7XG4gIH0pO1xufTtcblxuLy8gVGhlIG5vbi10aGlyZC1wYXJ0eSBwYXJ0cyBvZiBVc2VyIHRyYW5zZm9ybWF0aW9uXG5SZXN0V3JpdGUucHJvdG90eXBlLnRyYW5zZm9ybVVzZXIgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKTtcblxuICBpZiAodGhpcy5jbGFzc05hbWUgIT09ICdfVXNlcicpIHtcbiAgICByZXR1cm4gcHJvbWlzZTtcbiAgfVxuXG4gIGlmICghdGhpcy5hdXRoLmlzTWFzdGVyICYmICdlbWFpbFZlcmlmaWVkJyBpbiB0aGlzLmRhdGEpIHtcbiAgICBjb25zdCBlcnJvciA9IGBDbGllbnRzIGFyZW4ndCBhbGxvd2VkIHRvIG1hbnVhbGx5IHVwZGF0ZSBlbWFpbCB2ZXJpZmljYXRpb24uYDtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTiwgZXJyb3IpO1xuICB9XG5cbiAgLy8gRG8gbm90IGNsZWFudXAgc2Vzc2lvbiBpZiBvYmplY3RJZCBpcyBub3Qgc2V0XG4gIGlmICh0aGlzLnF1ZXJ5ICYmIHRoaXMub2JqZWN0SWQoKSkge1xuICAgIC8vIElmIHdlJ3JlIHVwZGF0aW5nIGEgX1VzZXIgb2JqZWN0LCB3ZSBuZWVkIHRvIGNsZWFyIG91dCB0aGUgY2FjaGUgZm9yIHRoYXQgdXNlci4gRmluZCBhbGwgdGhlaXJcbiAgICAvLyBzZXNzaW9uIHRva2VucywgYW5kIHJlbW92ZSB0aGVtIGZyb20gdGhlIGNhY2hlLlxuICAgIHByb21pc2UgPSBuZXcgUmVzdFF1ZXJ5KHRoaXMuY29uZmlnLCBBdXRoLm1hc3Rlcih0aGlzLmNvbmZpZyksICdfU2Vzc2lvbicsIHtcbiAgICAgIHVzZXI6IHtcbiAgICAgICAgX190eXBlOiAnUG9pbnRlcicsXG4gICAgICAgIGNsYXNzTmFtZTogJ19Vc2VyJyxcbiAgICAgICAgb2JqZWN0SWQ6IHRoaXMub2JqZWN0SWQoKSxcbiAgICAgIH0sXG4gICAgfSlcbiAgICAgIC5leGVjdXRlKClcbiAgICAgIC50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgICByZXN1bHRzLnJlc3VsdHMuZm9yRWFjaChzZXNzaW9uID0+XG4gICAgICAgICAgdGhpcy5jb25maWcuY2FjaGVDb250cm9sbGVyLnVzZXIuZGVsKHNlc3Npb24uc2Vzc2lvblRva2VuKVxuICAgICAgICApO1xuICAgICAgfSk7XG4gIH1cblxuICByZXR1cm4gcHJvbWlzZVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIC8vIFRyYW5zZm9ybSB0aGUgcGFzc3dvcmRcbiAgICAgIGlmICh0aGlzLmRhdGEucGFzc3dvcmQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAvLyBpZ25vcmUgb25seSBpZiB1bmRlZmluZWQuIHNob3VsZCBwcm9jZWVkIGlmIGVtcHR5ICgnJylcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5xdWVyeSkge1xuICAgICAgICB0aGlzLnN0b3JhZ2VbJ2NsZWFyU2Vzc2lvbnMnXSA9IHRydWU7XG4gICAgICAgIC8vIEdlbmVyYXRlIGEgbmV3IHNlc3Npb24gb25seSBpZiB0aGUgdXNlciByZXF1ZXN0ZWRcbiAgICAgICAgaWYgKCF0aGlzLmF1dGguaXNNYXN0ZXIpIHtcbiAgICAgICAgICB0aGlzLnN0b3JhZ2VbJ2dlbmVyYXRlTmV3U2Vzc2lvbiddID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGhpcy5fdmFsaWRhdGVQYXNzd29yZFBvbGljeSgpLnRoZW4oKCkgPT4ge1xuICAgICAgICByZXR1cm4gcGFzc3dvcmRDcnlwdG8uaGFzaCh0aGlzLmRhdGEucGFzc3dvcmQpLnRoZW4oaGFzaGVkUGFzc3dvcmQgPT4ge1xuICAgICAgICAgIHRoaXMuZGF0YS5faGFzaGVkX3Bhc3N3b3JkID0gaGFzaGVkUGFzc3dvcmQ7XG4gICAgICAgICAgZGVsZXRlIHRoaXMuZGF0YS5wYXNzd29yZDtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLl92YWxpZGF0ZVVzZXJOYW1lKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5fdmFsaWRhdGVFbWFpbCgpO1xuICAgIH0pO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5fdmFsaWRhdGVVc2VyTmFtZSA9IGZ1bmN0aW9uKCkge1xuICAvLyBDaGVjayBmb3IgdXNlcm5hbWUgdW5pcXVlbmVzc1xuICBpZiAoIXRoaXMuZGF0YS51c2VybmFtZSkge1xuICAgIGlmICghdGhpcy5xdWVyeSkge1xuICAgICAgdGhpcy5kYXRhLnVzZXJuYW1lID0gY3J5cHRvVXRpbHMucmFuZG9tU3RyaW5nKDI1KTtcbiAgICAgIHRoaXMucmVzcG9uc2VTaG91bGRIYXZlVXNlcm5hbWUgPSB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cbiAgLy8gV2UgbmVlZCB0byBhIGZpbmQgdG8gY2hlY2sgZm9yIGR1cGxpY2F0ZSB1c2VybmFtZSBpbiBjYXNlIHRoZXkgYXJlIG1pc3NpbmcgdGhlIHVuaXF1ZSBpbmRleCBvbiB1c2VybmFtZXNcbiAgLy8gVE9ETzogQ2hlY2sgaWYgdGhlcmUgaXMgYSB1bmlxdWUgaW5kZXgsIGFuZCBpZiBzbywgc2tpcCB0aGlzIHF1ZXJ5LlxuICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2VcbiAgICAuZmluZChcbiAgICAgIHRoaXMuY2xhc3NOYW1lLFxuICAgICAgeyB1c2VybmFtZTogdGhpcy5kYXRhLnVzZXJuYW1lLCBvYmplY3RJZDogeyAkbmU6IHRoaXMub2JqZWN0SWQoKSB9IH0sXG4gICAgICB7IGxpbWl0OiAxIH1cbiAgICApXG4gICAgLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICBpZiAocmVzdWx0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5VU0VSTkFNRV9UQUtFTixcbiAgICAgICAgICAnQWNjb3VudCBhbHJlYWR5IGV4aXN0cyBmb3IgdGhpcyB1c2VybmFtZS4nXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfSk7XG59O1xuXG5SZXN0V3JpdGUucHJvdG90eXBlLl92YWxpZGF0ZUVtYWlsID0gZnVuY3Rpb24oKSB7XG4gIGlmICghdGhpcy5kYXRhLmVtYWlsIHx8IHRoaXMuZGF0YS5lbWFpbC5fX29wID09PSAnRGVsZXRlJykge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuICAvLyBWYWxpZGF0ZSBiYXNpYyBlbWFpbCBhZGRyZXNzIGZvcm1hdFxuICBpZiAoIXRoaXMuZGF0YS5lbWFpbC5tYXRjaCgvXi4rQC4rJC8pKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVqZWN0KFxuICAgICAgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0VNQUlMX0FERFJFU1MsXG4gICAgICAgICdFbWFpbCBhZGRyZXNzIGZvcm1hdCBpcyBpbnZhbGlkLidcbiAgICAgIClcbiAgICApO1xuICB9XG4gIC8vIFNhbWUgcHJvYmxlbSBmb3IgZW1haWwgYXMgYWJvdmUgZm9yIHVzZXJuYW1lXG4gIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZVxuICAgIC5maW5kKFxuICAgICAgdGhpcy5jbGFzc05hbWUsXG4gICAgICB7IGVtYWlsOiB0aGlzLmRhdGEuZW1haWwsIG9iamVjdElkOiB7ICRuZTogdGhpcy5vYmplY3RJZCgpIH0gfSxcbiAgICAgIHsgbGltaXQ6IDEgfVxuICAgIClcbiAgICAudGhlbihyZXN1bHRzID0+IHtcbiAgICAgIGlmIChyZXN1bHRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLkVNQUlMX1RBS0VOLFxuICAgICAgICAgICdBY2NvdW50IGFscmVhZHkgZXhpc3RzIGZvciB0aGlzIGVtYWlsIGFkZHJlc3MuJ1xuICAgICAgICApO1xuICAgICAgfVxuICAgICAgaWYgKFxuICAgICAgICAhdGhpcy5kYXRhLmF1dGhEYXRhIHx8XG4gICAgICAgICFPYmplY3Qua2V5cyh0aGlzLmRhdGEuYXV0aERhdGEpLmxlbmd0aCB8fFxuICAgICAgICAoT2JqZWN0LmtleXModGhpcy5kYXRhLmF1dGhEYXRhKS5sZW5ndGggPT09IDEgJiZcbiAgICAgICAgICBPYmplY3Qua2V5cyh0aGlzLmRhdGEuYXV0aERhdGEpWzBdID09PSAnYW5vbnltb3VzJylcbiAgICAgICkge1xuICAgICAgICAvLyBXZSB1cGRhdGVkIHRoZSBlbWFpbCwgc2VuZCBhIG5ldyB2YWxpZGF0aW9uXG4gICAgICAgIHRoaXMuc3RvcmFnZVsnc2VuZFZlcmlmaWNhdGlvbkVtYWlsJ10gPSB0cnVlO1xuICAgICAgICB0aGlzLmNvbmZpZy51c2VyQ29udHJvbGxlci5zZXRFbWFpbFZlcmlmeVRva2VuKHRoaXMuZGF0YSk7XG4gICAgICB9XG4gICAgfSk7XG59O1xuXG5SZXN0V3JpdGUucHJvdG90eXBlLl92YWxpZGF0ZVBhc3N3b3JkUG9saWN5ID0gZnVuY3Rpb24oKSB7XG4gIGlmICghdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kpIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgcmV0dXJuIHRoaXMuX3ZhbGlkYXRlUGFzc3dvcmRSZXF1aXJlbWVudHMoKS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5fdmFsaWRhdGVQYXNzd29yZEhpc3RvcnkoKTtcbiAgfSk7XG59O1xuXG5SZXN0V3JpdGUucHJvdG90eXBlLl92YWxpZGF0ZVBhc3N3b3JkUmVxdWlyZW1lbnRzID0gZnVuY3Rpb24oKSB7XG4gIC8vIGNoZWNrIGlmIHRoZSBwYXNzd29yZCBjb25mb3JtcyB0byB0aGUgZGVmaW5lZCBwYXNzd29yZCBwb2xpY3kgaWYgY29uZmlndXJlZFxuICAvLyBJZiB3ZSBzcGVjaWZpZWQgYSBjdXN0b20gZXJyb3IgaW4gb3VyIGNvbmZpZ3VyYXRpb24gdXNlIGl0LlxuICAvLyBFeGFtcGxlOiBcIlBhc3N3b3JkcyBtdXN0IGluY2x1ZGUgYSBDYXBpdGFsIExldHRlciwgTG93ZXJjYXNlIExldHRlciwgYW5kIGEgbnVtYmVyLlwiXG4gIC8vXG4gIC8vIFRoaXMgaXMgZXNwZWNpYWxseSB1c2VmdWwgb24gdGhlIGdlbmVyaWMgXCJwYXNzd29yZCByZXNldFwiIHBhZ2UsXG4gIC8vIGFzIGl0IGFsbG93cyB0aGUgcHJvZ3JhbW1lciB0byBjb21tdW5pY2F0ZSBzcGVjaWZpYyByZXF1aXJlbWVudHMgaW5zdGVhZCBvZjpcbiAgLy8gYS4gbWFraW5nIHRoZSB1c2VyIGd1ZXNzIHdoYXRzIHdyb25nXG4gIC8vIGIuIG1ha2luZyBhIGN1c3RvbSBwYXNzd29yZCByZXNldCBwYWdlIHRoYXQgc2hvd3MgdGhlIHJlcXVpcmVtZW50c1xuICBjb25zdCBwb2xpY3lFcnJvciA9IHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5LnZhbGlkYXRpb25FcnJvclxuICAgID8gdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kudmFsaWRhdGlvbkVycm9yXG4gICAgOiAnUGFzc3dvcmQgZG9lcyBub3QgbWVldCB0aGUgUGFzc3dvcmQgUG9saWN5IHJlcXVpcmVtZW50cy4nO1xuICBjb25zdCBjb250YWluc1VzZXJuYW1lRXJyb3IgPSAnUGFzc3dvcmQgY2Fubm90IGNvbnRhaW4geW91ciB1c2VybmFtZS4nO1xuXG4gIC8vIGNoZWNrIHdoZXRoZXIgdGhlIHBhc3N3b3JkIG1lZXRzIHRoZSBwYXNzd29yZCBzdHJlbmd0aCByZXF1aXJlbWVudHNcbiAgaWYgKFxuICAgICh0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5wYXR0ZXJuVmFsaWRhdG9yICYmXG4gICAgICAhdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kucGF0dGVyblZhbGlkYXRvcih0aGlzLmRhdGEucGFzc3dvcmQpKSB8fFxuICAgICh0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS52YWxpZGF0b3JDYWxsYmFjayAmJlxuICAgICAgIXRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5LnZhbGlkYXRvckNhbGxiYWNrKHRoaXMuZGF0YS5wYXNzd29yZCkpXG4gICkge1xuICAgIHJldHVybiBQcm9taXNlLnJlamVjdChcbiAgICAgIG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5WQUxJREFUSU9OX0VSUk9SLCBwb2xpY3lFcnJvcilcbiAgICApO1xuICB9XG5cbiAgLy8gY2hlY2sgd2hldGhlciBwYXNzd29yZCBjb250YWluIHVzZXJuYW1lXG4gIGlmICh0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5kb05vdEFsbG93VXNlcm5hbWUgPT09IHRydWUpIHtcbiAgICBpZiAodGhpcy5kYXRhLnVzZXJuYW1lKSB7XG4gICAgICAvLyB1c2VybmFtZSBpcyBub3QgcGFzc2VkIGR1cmluZyBwYXNzd29yZCByZXNldFxuICAgICAgaWYgKHRoaXMuZGF0YS5wYXNzd29yZC5pbmRleE9mKHRoaXMuZGF0YS51c2VybmFtZSkgPj0gMClcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KFxuICAgICAgICAgIG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5WQUxJREFUSU9OX0VSUk9SLCBjb250YWluc1VzZXJuYW1lRXJyb3IpXG4gICAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIHJldHJpZXZlIHRoZSBVc2VyIG9iamVjdCB1c2luZyBvYmplY3RJZCBkdXJpbmcgcGFzc3dvcmQgcmVzZXRcbiAgICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZVxuICAgICAgICAuZmluZCgnX1VzZXInLCB7IG9iamVjdElkOiB0aGlzLm9iamVjdElkKCkgfSlcbiAgICAgICAgLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICAgICAgaWYgKHJlc3VsdHMubGVuZ3RoICE9IDEpIHtcbiAgICAgICAgICAgIHRocm93IHVuZGVmaW5lZDtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHRoaXMuZGF0YS5wYXNzd29yZC5pbmRleE9mKHJlc3VsdHNbMF0udXNlcm5hbWUpID49IDApXG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QoXG4gICAgICAgICAgICAgIG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgICBQYXJzZS5FcnJvci5WQUxJREFUSU9OX0VSUk9SLFxuICAgICAgICAgICAgICAgIGNvbnRhaW5zVXNlcm5hbWVFcnJvclxuICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuICB9XG4gIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuX3ZhbGlkYXRlUGFzc3dvcmRIaXN0b3J5ID0gZnVuY3Rpb24oKSB7XG4gIC8vIGNoZWNrIHdoZXRoZXIgcGFzc3dvcmQgaXMgcmVwZWF0aW5nIGZyb20gc3BlY2lmaWVkIGhpc3RvcnlcbiAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRIaXN0b3J5KSB7XG4gICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlXG4gICAgICAuZmluZChcbiAgICAgICAgJ19Vc2VyJyxcbiAgICAgICAgeyBvYmplY3RJZDogdGhpcy5vYmplY3RJZCgpIH0sXG4gICAgICAgIHsga2V5czogWydfcGFzc3dvcmRfaGlzdG9yeScsICdfaGFzaGVkX3Bhc3N3b3JkJ10gfVxuICAgICAgKVxuICAgICAgLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICAgIGlmIChyZXN1bHRzLmxlbmd0aCAhPSAxKSB7XG4gICAgICAgICAgdGhyb3cgdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHVzZXIgPSByZXN1bHRzWzBdO1xuICAgICAgICBsZXQgb2xkUGFzc3dvcmRzID0gW107XG4gICAgICAgIGlmICh1c2VyLl9wYXNzd29yZF9oaXN0b3J5KVxuICAgICAgICAgIG9sZFBhc3N3b3JkcyA9IF8udGFrZShcbiAgICAgICAgICAgIHVzZXIuX3Bhc3N3b3JkX2hpc3RvcnksXG4gICAgICAgICAgICB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5tYXhQYXNzd29yZEhpc3RvcnkgLSAxXG4gICAgICAgICAgKTtcbiAgICAgICAgb2xkUGFzc3dvcmRzLnB1c2godXNlci5wYXNzd29yZCk7XG4gICAgICAgIGNvbnN0IG5ld1Bhc3N3b3JkID0gdGhpcy5kYXRhLnBhc3N3b3JkO1xuICAgICAgICAvLyBjb21wYXJlIHRoZSBuZXcgcGFzc3dvcmQgaGFzaCB3aXRoIGFsbCBvbGQgcGFzc3dvcmQgaGFzaGVzXG4gICAgICAgIGNvbnN0IHByb21pc2VzID0gb2xkUGFzc3dvcmRzLm1hcChmdW5jdGlvbihoYXNoKSB7XG4gICAgICAgICAgcmV0dXJuIHBhc3N3b3JkQ3J5cHRvLmNvbXBhcmUobmV3UGFzc3dvcmQsIGhhc2gpLnRoZW4ocmVzdWx0ID0+IHtcbiAgICAgICAgICAgIGlmIChyZXN1bHQpXG4gICAgICAgICAgICAgIC8vIHJlamVjdCBpZiB0aGVyZSBpcyBhIG1hdGNoXG4gICAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdCgnUkVQRUFUX1BBU1NXT1JEJyk7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICAvLyB3YWl0IGZvciBhbGwgY29tcGFyaXNvbnMgdG8gY29tcGxldGVcbiAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKHByb21pc2VzKVxuICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5jYXRjaChlcnIgPT4ge1xuICAgICAgICAgICAgaWYgKGVyciA9PT0gJ1JFUEVBVF9QQVNTV09SRCcpXG4gICAgICAgICAgICAgIC8vIGEgbWF0Y2ggd2FzIGZvdW5kXG4gICAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChcbiAgICAgICAgICAgICAgICBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgICAgICBQYXJzZS5FcnJvci5WQUxJREFUSU9OX0VSUk9SLFxuICAgICAgICAgICAgICAgICAgYE5ldyBwYXNzd29yZCBzaG91bGQgbm90IGJlIHRoZSBzYW1lIGFzIGxhc3QgJHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRIaXN0b3J5XG4gICAgICAgICAgICAgICAgICB9IHBhc3N3b3Jkcy5gXG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5jcmVhdGVTZXNzaW9uVG9rZW5JZk5lZWRlZCA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5jbGFzc05hbWUgIT09ICdfVXNlcicpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHRoaXMucXVlcnkpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKFxuICAgICF0aGlzLnN0b3JhZ2VbJ2F1dGhQcm92aWRlciddICYmIC8vIHNpZ251cCBjYWxsLCB3aXRoXG4gICAgdGhpcy5jb25maWcucHJldmVudExvZ2luV2l0aFVudmVyaWZpZWRFbWFpbCAmJiAvLyBubyBsb2dpbiB3aXRob3V0IHZlcmlmaWNhdGlvblxuICAgIHRoaXMuY29uZmlnLnZlcmlmeVVzZXJFbWFpbHNcbiAgKSB7XG4gICAgLy8gdmVyaWZpY2F0aW9uIGlzIG9uXG4gICAgcmV0dXJuOyAvLyBkbyBub3QgY3JlYXRlIHRoZSBzZXNzaW9uIHRva2VuIGluIHRoYXQgY2FzZSFcbiAgfVxuICByZXR1cm4gdGhpcy5jcmVhdGVTZXNzaW9uVG9rZW4oKTtcbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuY3JlYXRlU2Vzc2lvblRva2VuID0gZnVuY3Rpb24oKSB7XG4gIC8vIGNsb3VkIGluc3RhbGxhdGlvbklkIGZyb20gQ2xvdWQgQ29kZSxcbiAgLy8gbmV2ZXIgY3JlYXRlIHNlc3Npb24gdG9rZW5zIGZyb20gdGhlcmUuXG4gIGlmICh0aGlzLmF1dGguaW5zdGFsbGF0aW9uSWQgJiYgdGhpcy5hdXRoLmluc3RhbGxhdGlvbklkID09PSAnY2xvdWQnKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgeyBzZXNzaW9uRGF0YSwgY3JlYXRlU2Vzc2lvbiB9ID0gQXV0aC5jcmVhdGVTZXNzaW9uKHRoaXMuY29uZmlnLCB7XG4gICAgdXNlcklkOiB0aGlzLm9iamVjdElkKCksXG4gICAgY3JlYXRlZFdpdGg6IHtcbiAgICAgIGFjdGlvbjogdGhpcy5zdG9yYWdlWydhdXRoUHJvdmlkZXInXSA/ICdsb2dpbicgOiAnc2lnbnVwJyxcbiAgICAgIGF1dGhQcm92aWRlcjogdGhpcy5zdG9yYWdlWydhdXRoUHJvdmlkZXInXSB8fCAncGFzc3dvcmQnLFxuICAgIH0sXG4gICAgaW5zdGFsbGF0aW9uSWQ6IHRoaXMuYXV0aC5pbnN0YWxsYXRpb25JZCxcbiAgfSk7XG5cbiAgaWYgKHRoaXMucmVzcG9uc2UgJiYgdGhpcy5yZXNwb25zZS5yZXNwb25zZSkge1xuICAgIHRoaXMucmVzcG9uc2UucmVzcG9uc2Uuc2Vzc2lvblRva2VuID0gc2Vzc2lvbkRhdGEuc2Vzc2lvblRva2VuO1xuICB9XG5cbiAgcmV0dXJuIGNyZWF0ZVNlc3Npb24oKTtcbn07XG5cbi8vIERlbGV0ZSBlbWFpbCByZXNldCB0b2tlbnMgaWYgdXNlciBpcyBjaGFuZ2luZyBwYXNzd29yZCBvciBlbWFpbC5cblJlc3RXcml0ZS5wcm90b3R5cGUuZGVsZXRlRW1haWxSZXNldFRva2VuSWZOZWVkZWQgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMuY2xhc3NOYW1lICE9PSAnX1VzZXInIHx8IHRoaXMucXVlcnkgPT09IG51bGwpIHtcbiAgICAvLyBudWxsIHF1ZXJ5IG1lYW5zIGNyZWF0ZVxuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICgncGFzc3dvcmQnIGluIHRoaXMuZGF0YSB8fCAnZW1haWwnIGluIHRoaXMuZGF0YSkge1xuICAgIGNvbnN0IGFkZE9wcyA9IHtcbiAgICAgIF9wZXJpc2hhYmxlX3Rva2VuOiB7IF9fb3A6ICdEZWxldGUnIH0sXG4gICAgICBfcGVyaXNoYWJsZV90b2tlbl9leHBpcmVzX2F0OiB7IF9fb3A6ICdEZWxldGUnIH0sXG4gICAgfTtcbiAgICB0aGlzLmRhdGEgPSBPYmplY3QuYXNzaWduKHRoaXMuZGF0YSwgYWRkT3BzKTtcbiAgfVxufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5kZXN0cm95RHVwbGljYXRlZFNlc3Npb25zID0gZnVuY3Rpb24oKSB7XG4gIC8vIE9ubHkgZm9yIF9TZXNzaW9uLCBhbmQgYXQgY3JlYXRpb24gdGltZVxuICBpZiAodGhpcy5jbGFzc05hbWUgIT0gJ19TZXNzaW9uJyB8fCB0aGlzLnF1ZXJ5KSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIERlc3Ryb3kgdGhlIHNlc3Npb25zIGluICdCYWNrZ3JvdW5kJ1xuICBjb25zdCB7IHVzZXIsIGluc3RhbGxhdGlvbklkLCBzZXNzaW9uVG9rZW4gfSA9IHRoaXMuZGF0YTtcbiAgaWYgKCF1c2VyIHx8ICFpbnN0YWxsYXRpb25JZCkge1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIXVzZXIub2JqZWN0SWQpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgdGhpcy5jb25maWcuZGF0YWJhc2UuZGVzdHJveSgnX1Nlc3Npb24nLCB7XG4gICAgdXNlcixcbiAgICBpbnN0YWxsYXRpb25JZCxcbiAgICBzZXNzaW9uVG9rZW46IHsgJG5lOiBzZXNzaW9uVG9rZW4gfSxcbiAgfSk7XG59O1xuXG4vLyBIYW5kbGVzIGFueSBmb2xsb3d1cCBsb2dpY1xuUmVzdFdyaXRlLnByb3RvdHlwZS5oYW5kbGVGb2xsb3d1cCA9IGZ1bmN0aW9uKCkge1xuICBpZiAoXG4gICAgdGhpcy5zdG9yYWdlICYmXG4gICAgdGhpcy5zdG9yYWdlWydjbGVhclNlc3Npb25zJ10gJiZcbiAgICB0aGlzLmNvbmZpZy5yZXZva2VTZXNzaW9uT25QYXNzd29yZFJlc2V0XG4gICkge1xuICAgIHZhciBzZXNzaW9uUXVlcnkgPSB7XG4gICAgICB1c2VyOiB7XG4gICAgICAgIF9fdHlwZTogJ1BvaW50ZXInLFxuICAgICAgICBjbGFzc05hbWU6ICdfVXNlcicsXG4gICAgICAgIG9iamVjdElkOiB0aGlzLm9iamVjdElkKCksXG4gICAgICB9LFxuICAgIH07XG4gICAgZGVsZXRlIHRoaXMuc3RvcmFnZVsnY2xlYXJTZXNzaW9ucyddO1xuICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZVxuICAgICAgLmRlc3Ryb3koJ19TZXNzaW9uJywgc2Vzc2lvblF1ZXJ5KVxuICAgICAgLnRoZW4odGhpcy5oYW5kbGVGb2xsb3d1cC5iaW5kKHRoaXMpKTtcbiAgfVxuXG4gIGlmICh0aGlzLnN0b3JhZ2UgJiYgdGhpcy5zdG9yYWdlWydnZW5lcmF0ZU5ld1Nlc3Npb24nXSkge1xuICAgIGRlbGV0ZSB0aGlzLnN0b3JhZ2VbJ2dlbmVyYXRlTmV3U2Vzc2lvbiddO1xuICAgIHJldHVybiB0aGlzLmNyZWF0ZVNlc3Npb25Ub2tlbigpLnRoZW4odGhpcy5oYW5kbGVGb2xsb3d1cC5iaW5kKHRoaXMpKTtcbiAgfVxuXG4gIGlmICh0aGlzLnN0b3JhZ2UgJiYgdGhpcy5zdG9yYWdlWydzZW5kVmVyaWZpY2F0aW9uRW1haWwnXSkge1xuICAgIGRlbGV0ZSB0aGlzLnN0b3JhZ2VbJ3NlbmRWZXJpZmljYXRpb25FbWFpbCddO1xuICAgIC8vIEZpcmUgYW5kIGZvcmdldCFcbiAgICB0aGlzLmNvbmZpZy51c2VyQ29udHJvbGxlci5zZW5kVmVyaWZpY2F0aW9uRW1haWwodGhpcy5kYXRhKTtcbiAgICByZXR1cm4gdGhpcy5oYW5kbGVGb2xsb3d1cC5iaW5kKHRoaXMpO1xuICB9XG59O1xuXG4vLyBIYW5kbGVzIHRoZSBfU2Vzc2lvbiBjbGFzcyBzcGVjaWFsbmVzcy5cbi8vIERvZXMgbm90aGluZyBpZiB0aGlzIGlzbid0IGFuIF9TZXNzaW9uIG9iamVjdC5cblJlc3RXcml0ZS5wcm90b3R5cGUuaGFuZGxlU2Vzc2lvbiA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5yZXNwb25zZSB8fCB0aGlzLmNsYXNzTmFtZSAhPT0gJ19TZXNzaW9uJykge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICghdGhpcy5hdXRoLnVzZXIgJiYgIXRoaXMuYXV0aC5pc01hc3Rlcikge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfU0VTU0lPTl9UT0tFTixcbiAgICAgICdTZXNzaW9uIHRva2VuIHJlcXVpcmVkLidcbiAgICApO1xuICB9XG5cbiAgLy8gVE9ETzogVmVyaWZ5IHByb3BlciBlcnJvciB0byB0aHJvd1xuICBpZiAodGhpcy5kYXRhLkFDTCkge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUsXG4gICAgICAnQ2Fubm90IHNldCAnICsgJ0FDTCBvbiBhIFNlc3Npb24uJ1xuICAgICk7XG4gIH1cblxuICBpZiAodGhpcy5xdWVyeSkge1xuICAgIGlmIChcbiAgICAgIHRoaXMuZGF0YS51c2VyICYmXG4gICAgICAhdGhpcy5hdXRoLmlzTWFzdGVyICYmXG4gICAgICB0aGlzLmRhdGEudXNlci5vYmplY3RJZCAhPSB0aGlzLmF1dGgudXNlci5pZFxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5kYXRhLmluc3RhbGxhdGlvbklkKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmRhdGEuc2Vzc2lvblRva2VuKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSk7XG4gICAgfVxuICB9XG5cbiAgaWYgKCF0aGlzLnF1ZXJ5ICYmICF0aGlzLmF1dGguaXNNYXN0ZXIpIHtcbiAgICBjb25zdCBhZGRpdGlvbmFsU2Vzc2lvbkRhdGEgPSB7fTtcbiAgICBmb3IgKHZhciBrZXkgaW4gdGhpcy5kYXRhKSB7XG4gICAgICBpZiAoa2V5ID09PSAnb2JqZWN0SWQnIHx8IGtleSA9PT0gJ3VzZXInKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgYWRkaXRpb25hbFNlc3Npb25EYXRhW2tleV0gPSB0aGlzLmRhdGFba2V5XTtcbiAgICB9XG5cbiAgICBjb25zdCB7IHNlc3Npb25EYXRhLCBjcmVhdGVTZXNzaW9uIH0gPSBBdXRoLmNyZWF0ZVNlc3Npb24odGhpcy5jb25maWcsIHtcbiAgICAgIHVzZXJJZDogdGhpcy5hdXRoLnVzZXIuaWQsXG4gICAgICBjcmVhdGVkV2l0aDoge1xuICAgICAgICBhY3Rpb246ICdjcmVhdGUnLFxuICAgICAgfSxcbiAgICAgIGFkZGl0aW9uYWxTZXNzaW9uRGF0YSxcbiAgICB9KTtcblxuICAgIHJldHVybiBjcmVhdGVTZXNzaW9uKCkudGhlbihyZXN1bHRzID0+IHtcbiAgICAgIGlmICghcmVzdWx0cy5yZXNwb25zZSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5URVJOQUxfU0VSVkVSX0VSUk9SLFxuICAgICAgICAgICdFcnJvciBjcmVhdGluZyBzZXNzaW9uLidcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHNlc3Npb25EYXRhWydvYmplY3RJZCddID0gcmVzdWx0cy5yZXNwb25zZVsnb2JqZWN0SWQnXTtcbiAgICAgIHRoaXMucmVzcG9uc2UgPSB7XG4gICAgICAgIHN0YXR1czogMjAxLFxuICAgICAgICBsb2NhdGlvbjogcmVzdWx0cy5sb2NhdGlvbixcbiAgICAgICAgcmVzcG9uc2U6IHNlc3Npb25EYXRhLFxuICAgICAgfTtcbiAgICB9KTtcbiAgfVxufTtcblxuLy8gSGFuZGxlcyB0aGUgX0luc3RhbGxhdGlvbiBjbGFzcyBzcGVjaWFsbmVzcy5cbi8vIERvZXMgbm90aGluZyBpZiB0aGlzIGlzbid0IGFuIGluc3RhbGxhdGlvbiBvYmplY3QuXG4vLyBJZiBhbiBpbnN0YWxsYXRpb24gaXMgZm91bmQsIHRoaXMgY2FuIG11dGF0ZSB0aGlzLnF1ZXJ5IGFuZCB0dXJuIGEgY3JlYXRlXG4vLyBpbnRvIGFuIHVwZGF0ZS5cbi8vIFJldHVybnMgYSBwcm9taXNlIGZvciB3aGVuIHdlJ3JlIGRvbmUgaWYgaXQgY2FuJ3QgZmluaXNoIHRoaXMgdGljay5cblJlc3RXcml0ZS5wcm90b3R5cGUuaGFuZGxlSW5zdGFsbGF0aW9uID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLnJlc3BvbnNlIHx8IHRoaXMuY2xhc3NOYW1lICE9PSAnX0luc3RhbGxhdGlvbicpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAoXG4gICAgIXRoaXMucXVlcnkgJiZcbiAgICAhdGhpcy5kYXRhLmRldmljZVRva2VuICYmXG4gICAgIXRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZCAmJlxuICAgICF0aGlzLmF1dGguaW5zdGFsbGF0aW9uSWRcbiAgKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgMTM1LFxuICAgICAgJ2F0IGxlYXN0IG9uZSBJRCBmaWVsZCAoZGV2aWNlVG9rZW4sIGluc3RhbGxhdGlvbklkKSAnICtcbiAgICAgICAgJ211c3QgYmUgc3BlY2lmaWVkIGluIHRoaXMgb3BlcmF0aW9uJ1xuICAgICk7XG4gIH1cblxuICAvLyBJZiB0aGUgZGV2aWNlIHRva2VuIGlzIDY0IGNoYXJhY3RlcnMgbG9uZywgd2UgYXNzdW1lIGl0IGlzIGZvciBpT1NcbiAgLy8gYW5kIGxvd2VyY2FzZSBpdC5cbiAgaWYgKHRoaXMuZGF0YS5kZXZpY2VUb2tlbiAmJiB0aGlzLmRhdGEuZGV2aWNlVG9rZW4ubGVuZ3RoID09IDY0KSB7XG4gICAgdGhpcy5kYXRhLmRldmljZVRva2VuID0gdGhpcy5kYXRhLmRldmljZVRva2VuLnRvTG93ZXJDYXNlKCk7XG4gIH1cblxuICAvLyBXZSBsb3dlcmNhc2UgdGhlIGluc3RhbGxhdGlvbklkIGlmIHByZXNlbnRcbiAgaWYgKHRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZCkge1xuICAgIHRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZCA9IHRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZC50b0xvd2VyQ2FzZSgpO1xuICB9XG5cbiAgbGV0IGluc3RhbGxhdGlvbklkID0gdGhpcy5kYXRhLmluc3RhbGxhdGlvbklkO1xuXG4gIC8vIElmIGRhdGEuaW5zdGFsbGF0aW9uSWQgaXMgbm90IHNldCBhbmQgd2UncmUgbm90IG1hc3Rlciwgd2UgY2FuIGxvb2t1cCBpbiBhdXRoXG4gIGlmICghaW5zdGFsbGF0aW9uSWQgJiYgIXRoaXMuYXV0aC5pc01hc3Rlcikge1xuICAgIGluc3RhbGxhdGlvbklkID0gdGhpcy5hdXRoLmluc3RhbGxhdGlvbklkO1xuICB9XG5cbiAgaWYgKGluc3RhbGxhdGlvbklkKSB7XG4gICAgaW5zdGFsbGF0aW9uSWQgPSBpbnN0YWxsYXRpb25JZC50b0xvd2VyQ2FzZSgpO1xuICB9XG5cbiAgLy8gVXBkYXRpbmcgX0luc3RhbGxhdGlvbiBidXQgbm90IHVwZGF0aW5nIGFueXRoaW5nIGNyaXRpY2FsXG4gIGlmIChcbiAgICB0aGlzLnF1ZXJ5ICYmXG4gICAgIXRoaXMuZGF0YS5kZXZpY2VUb2tlbiAmJlxuICAgICFpbnN0YWxsYXRpb25JZCAmJlxuICAgICF0aGlzLmRhdGEuZGV2aWNlVHlwZVxuICApIHtcbiAgICByZXR1cm47XG4gIH1cblxuICB2YXIgcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xuXG4gIHZhciBpZE1hdGNoOyAvLyBXaWxsIGJlIGEgbWF0Y2ggb24gZWl0aGVyIG9iamVjdElkIG9yIGluc3RhbGxhdGlvbklkXG4gIHZhciBvYmplY3RJZE1hdGNoO1xuICB2YXIgaW5zdGFsbGF0aW9uSWRNYXRjaDtcbiAgdmFyIGRldmljZVRva2VuTWF0Y2hlcyA9IFtdO1xuXG4gIC8vIEluc3RlYWQgb2YgaXNzdWluZyAzIHJlYWRzLCBsZXQncyBkbyBpdCB3aXRoIG9uZSBPUi5cbiAgY29uc3Qgb3JRdWVyaWVzID0gW107XG4gIGlmICh0aGlzLnF1ZXJ5ICYmIHRoaXMucXVlcnkub2JqZWN0SWQpIHtcbiAgICBvclF1ZXJpZXMucHVzaCh7XG4gICAgICBvYmplY3RJZDogdGhpcy5xdWVyeS5vYmplY3RJZCxcbiAgICB9KTtcbiAgfVxuICBpZiAoaW5zdGFsbGF0aW9uSWQpIHtcbiAgICBvclF1ZXJpZXMucHVzaCh7XG4gICAgICBpbnN0YWxsYXRpb25JZDogaW5zdGFsbGF0aW9uSWQsXG4gICAgfSk7XG4gIH1cbiAgaWYgKHRoaXMuZGF0YS5kZXZpY2VUb2tlbikge1xuICAgIG9yUXVlcmllcy5wdXNoKHsgZGV2aWNlVG9rZW46IHRoaXMuZGF0YS5kZXZpY2VUb2tlbiB9KTtcbiAgfVxuXG4gIGlmIChvclF1ZXJpZXMubGVuZ3RoID09IDApIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBwcm9taXNlID0gcHJvbWlzZVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZS5maW5kKFxuICAgICAgICAnX0luc3RhbGxhdGlvbicsXG4gICAgICAgIHtcbiAgICAgICAgICAkb3I6IG9yUXVlcmllcyxcbiAgICAgICAgfSxcbiAgICAgICAge31cbiAgICAgICk7XG4gICAgfSlcbiAgICAudGhlbihyZXN1bHRzID0+IHtcbiAgICAgIHJlc3VsdHMuZm9yRWFjaChyZXN1bHQgPT4ge1xuICAgICAgICBpZiAoXG4gICAgICAgICAgdGhpcy5xdWVyeSAmJlxuICAgICAgICAgIHRoaXMucXVlcnkub2JqZWN0SWQgJiZcbiAgICAgICAgICByZXN1bHQub2JqZWN0SWQgPT0gdGhpcy5xdWVyeS5vYmplY3RJZFxuICAgICAgICApIHtcbiAgICAgICAgICBvYmplY3RJZE1hdGNoID0gcmVzdWx0O1xuICAgICAgICB9XG4gICAgICAgIGlmIChyZXN1bHQuaW5zdGFsbGF0aW9uSWQgPT0gaW5zdGFsbGF0aW9uSWQpIHtcbiAgICAgICAgICBpbnN0YWxsYXRpb25JZE1hdGNoID0gcmVzdWx0O1xuICAgICAgICB9XG4gICAgICAgIGlmIChyZXN1bHQuZGV2aWNlVG9rZW4gPT0gdGhpcy5kYXRhLmRldmljZVRva2VuKSB7XG4gICAgICAgICAgZGV2aWNlVG9rZW5NYXRjaGVzLnB1c2gocmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIC8vIFNhbml0eSBjaGVja3Mgd2hlbiBydW5uaW5nIGEgcXVlcnlcbiAgICAgIGlmICh0aGlzLnF1ZXJ5ICYmIHRoaXMucXVlcnkub2JqZWN0SWQpIHtcbiAgICAgICAgaWYgKCFvYmplY3RJZE1hdGNoKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCxcbiAgICAgICAgICAgICdPYmplY3Qgbm90IGZvdW5kIGZvciB1cGRhdGUuJ1xuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKFxuICAgICAgICAgIHRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZCAmJlxuICAgICAgICAgIG9iamVjdElkTWF0Y2guaW5zdGFsbGF0aW9uSWQgJiZcbiAgICAgICAgICB0aGlzLmRhdGEuaW5zdGFsbGF0aW9uSWQgIT09IG9iamVjdElkTWF0Y2guaW5zdGFsbGF0aW9uSWRcbiAgICAgICAgKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgMTM2LFxuICAgICAgICAgICAgJ2luc3RhbGxhdGlvbklkIG1heSBub3QgYmUgY2hhbmdlZCBpbiB0aGlzICcgKyAnb3BlcmF0aW9uJ1xuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKFxuICAgICAgICAgIHRoaXMuZGF0YS5kZXZpY2VUb2tlbiAmJlxuICAgICAgICAgIG9iamVjdElkTWF0Y2guZGV2aWNlVG9rZW4gJiZcbiAgICAgICAgICB0aGlzLmRhdGEuZGV2aWNlVG9rZW4gIT09IG9iamVjdElkTWF0Y2guZGV2aWNlVG9rZW4gJiZcbiAgICAgICAgICAhdGhpcy5kYXRhLmluc3RhbGxhdGlvbklkICYmXG4gICAgICAgICAgIW9iamVjdElkTWF0Y2guaW5zdGFsbGF0aW9uSWRcbiAgICAgICAgKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgMTM2LFxuICAgICAgICAgICAgJ2RldmljZVRva2VuIG1heSBub3QgYmUgY2hhbmdlZCBpbiB0aGlzICcgKyAnb3BlcmF0aW9uJ1xuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKFxuICAgICAgICAgIHRoaXMuZGF0YS5kZXZpY2VUeXBlICYmXG4gICAgICAgICAgdGhpcy5kYXRhLmRldmljZVR5cGUgJiZcbiAgICAgICAgICB0aGlzLmRhdGEuZGV2aWNlVHlwZSAhPT0gb2JqZWN0SWRNYXRjaC5kZXZpY2VUeXBlXG4gICAgICAgICkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIDEzNixcbiAgICAgICAgICAgICdkZXZpY2VUeXBlIG1heSBub3QgYmUgY2hhbmdlZCBpbiB0aGlzICcgKyAnb3BlcmF0aW9uJ1xuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5xdWVyeS5vYmplY3RJZCAmJiBvYmplY3RJZE1hdGNoKSB7XG4gICAgICAgIGlkTWF0Y2ggPSBvYmplY3RJZE1hdGNoO1xuICAgICAgfVxuXG4gICAgICBpZiAoaW5zdGFsbGF0aW9uSWQgJiYgaW5zdGFsbGF0aW9uSWRNYXRjaCkge1xuICAgICAgICBpZE1hdGNoID0gaW5zdGFsbGF0aW9uSWRNYXRjaDtcbiAgICAgIH1cbiAgICAgIC8vIG5lZWQgdG8gc3BlY2lmeSBkZXZpY2VUeXBlIG9ubHkgaWYgaXQncyBuZXdcbiAgICAgIGlmICghdGhpcy5xdWVyeSAmJiAhdGhpcy5kYXRhLmRldmljZVR5cGUgJiYgIWlkTWF0Y2gpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIDEzNSxcbiAgICAgICAgICAnZGV2aWNlVHlwZSBtdXN0IGJlIHNwZWNpZmllZCBpbiB0aGlzIG9wZXJhdGlvbidcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIGlmICghaWRNYXRjaCkge1xuICAgICAgICBpZiAoIWRldmljZVRva2VuTWF0Y2hlcy5sZW5ndGgpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgICAgZGV2aWNlVG9rZW5NYXRjaGVzLmxlbmd0aCA9PSAxICYmXG4gICAgICAgICAgKCFkZXZpY2VUb2tlbk1hdGNoZXNbMF1bJ2luc3RhbGxhdGlvbklkJ10gfHwgIWluc3RhbGxhdGlvbklkKVxuICAgICAgICApIHtcbiAgICAgICAgICAvLyBTaW5nbGUgbWF0Y2ggb24gZGV2aWNlIHRva2VuIGJ1dCBub25lIG9uIGluc3RhbGxhdGlvbklkLCBhbmQgZWl0aGVyXG4gICAgICAgICAgLy8gdGhlIHBhc3NlZCBvYmplY3Qgb3IgdGhlIG1hdGNoIGlzIG1pc3NpbmcgYW4gaW5zdGFsbGF0aW9uSWQsIHNvIHdlXG4gICAgICAgICAgLy8gY2FuIGp1c3QgcmV0dXJuIHRoZSBtYXRjaC5cbiAgICAgICAgICByZXR1cm4gZGV2aWNlVG9rZW5NYXRjaGVzWzBdWydvYmplY3RJZCddO1xuICAgICAgICB9IGVsc2UgaWYgKCF0aGlzLmRhdGEuaW5zdGFsbGF0aW9uSWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAxMzIsXG4gICAgICAgICAgICAnTXVzdCBzcGVjaWZ5IGluc3RhbGxhdGlvbklkIHdoZW4gZGV2aWNlVG9rZW4gJyArXG4gICAgICAgICAgICAgICdtYXRjaGVzIG11bHRpcGxlIEluc3RhbGxhdGlvbiBvYmplY3RzJ1xuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gTXVsdGlwbGUgZGV2aWNlIHRva2VuIG1hdGNoZXMgYW5kIHdlIHNwZWNpZmllZCBhbiBpbnN0YWxsYXRpb24gSUQsXG4gICAgICAgICAgLy8gb3IgYSBzaW5nbGUgbWF0Y2ggd2hlcmUgYm90aCB0aGUgcGFzc2VkIGFuZCBtYXRjaGluZyBvYmplY3RzIGhhdmVcbiAgICAgICAgICAvLyBhbiBpbnN0YWxsYXRpb24gSUQuIFRyeSBjbGVhbmluZyBvdXQgb2xkIGluc3RhbGxhdGlvbnMgdGhhdCBtYXRjaFxuICAgICAgICAgIC8vIHRoZSBkZXZpY2VUb2tlbiwgYW5kIHJldHVybiBuaWwgdG8gc2lnbmFsIHRoYXQgYSBuZXcgb2JqZWN0IHNob3VsZFxuICAgICAgICAgIC8vIGJlIGNyZWF0ZWQuXG4gICAgICAgICAgdmFyIGRlbFF1ZXJ5ID0ge1xuICAgICAgICAgICAgZGV2aWNlVG9rZW46IHRoaXMuZGF0YS5kZXZpY2VUb2tlbixcbiAgICAgICAgICAgIGluc3RhbGxhdGlvbklkOiB7XG4gICAgICAgICAgICAgICRuZTogaW5zdGFsbGF0aW9uSWQsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH07XG4gICAgICAgICAgaWYgKHRoaXMuZGF0YS5hcHBJZGVudGlmaWVyKSB7XG4gICAgICAgICAgICBkZWxRdWVyeVsnYXBwSWRlbnRpZmllciddID0gdGhpcy5kYXRhLmFwcElkZW50aWZpZXI7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMuY29uZmlnLmRhdGFiYXNlLmRlc3Ryb3koJ19JbnN0YWxsYXRpb24nLCBkZWxRdWVyeSkuY2F0Y2goZXJyID0+IHtcbiAgICAgICAgICAgIGlmIChlcnIuY29kZSA9PSBQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5EKSB7XG4gICAgICAgICAgICAgIC8vIG5vIGRlbGV0aW9ucyB3ZXJlIG1hZGUuIENhbiBiZSBpZ25vcmVkLlxuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyByZXRocm93IHRoZSBlcnJvclxuICAgICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIGRldmljZVRva2VuTWF0Y2hlcy5sZW5ndGggPT0gMSAmJlxuICAgICAgICAgICFkZXZpY2VUb2tlbk1hdGNoZXNbMF1bJ2luc3RhbGxhdGlvbklkJ11cbiAgICAgICAgKSB7XG4gICAgICAgICAgLy8gRXhhY3RseSBvbmUgZGV2aWNlIHRva2VuIG1hdGNoIGFuZCBpdCBkb2Vzbid0IGhhdmUgYW4gaW5zdGFsbGF0aW9uXG4gICAgICAgICAgLy8gSUQuIFRoaXMgaXMgdGhlIG9uZSBjYXNlIHdoZXJlIHdlIHdhbnQgdG8gbWVyZ2Ugd2l0aCB0aGUgZXhpc3RpbmdcbiAgICAgICAgICAvLyBvYmplY3QuXG4gICAgICAgICAgY29uc3QgZGVsUXVlcnkgPSB7IG9iamVjdElkOiBpZE1hdGNoLm9iamVjdElkIH07XG4gICAgICAgICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlXG4gICAgICAgICAgICAuZGVzdHJveSgnX0luc3RhbGxhdGlvbicsIGRlbFF1ZXJ5KVxuICAgICAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgICByZXR1cm4gZGV2aWNlVG9rZW5NYXRjaGVzWzBdWydvYmplY3RJZCddO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC5jYXRjaChlcnIgPT4ge1xuICAgICAgICAgICAgICBpZiAoZXJyLmNvZGUgPT0gUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCkge1xuICAgICAgICAgICAgICAgIC8vIG5vIGRlbGV0aW9ucyB3ZXJlIG1hZGUuIENhbiBiZSBpZ25vcmVkXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIC8vIHJldGhyb3cgdGhlIGVycm9yXG4gICAgICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgIHRoaXMuZGF0YS5kZXZpY2VUb2tlbiAmJlxuICAgICAgICAgICAgaWRNYXRjaC5kZXZpY2VUb2tlbiAhPSB0aGlzLmRhdGEuZGV2aWNlVG9rZW5cbiAgICAgICAgICApIHtcbiAgICAgICAgICAgIC8vIFdlJ3JlIHNldHRpbmcgdGhlIGRldmljZSB0b2tlbiBvbiBhbiBleGlzdGluZyBpbnN0YWxsYXRpb24sIHNvXG4gICAgICAgICAgICAvLyB3ZSBzaG91bGQgdHJ5IGNsZWFuaW5nIG91dCBvbGQgaW5zdGFsbGF0aW9ucyB0aGF0IG1hdGNoIHRoaXNcbiAgICAgICAgICAgIC8vIGRldmljZSB0b2tlbi5cbiAgICAgICAgICAgIGNvbnN0IGRlbFF1ZXJ5ID0ge1xuICAgICAgICAgICAgICBkZXZpY2VUb2tlbjogdGhpcy5kYXRhLmRldmljZVRva2VuLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIC8vIFdlIGhhdmUgYSB1bmlxdWUgaW5zdGFsbCBJZCwgdXNlIHRoYXQgdG8gcHJlc2VydmVcbiAgICAgICAgICAgIC8vIHRoZSBpbnRlcmVzdGluZyBpbnN0YWxsYXRpb25cbiAgICAgICAgICAgIGlmICh0aGlzLmRhdGEuaW5zdGFsbGF0aW9uSWQpIHtcbiAgICAgICAgICAgICAgZGVsUXVlcnlbJ2luc3RhbGxhdGlvbklkJ10gPSB7XG4gICAgICAgICAgICAgICAgJG5lOiB0aGlzLmRhdGEuaW5zdGFsbGF0aW9uSWQsXG4gICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9IGVsc2UgaWYgKFxuICAgICAgICAgICAgICBpZE1hdGNoLm9iamVjdElkICYmXG4gICAgICAgICAgICAgIHRoaXMuZGF0YS5vYmplY3RJZCAmJlxuICAgICAgICAgICAgICBpZE1hdGNoLm9iamVjdElkID09IHRoaXMuZGF0YS5vYmplY3RJZFxuICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgIC8vIHdlIHBhc3NlZCBhbiBvYmplY3RJZCwgcHJlc2VydmUgdGhhdCBpbnN0YWxhdGlvblxuICAgICAgICAgICAgICBkZWxRdWVyeVsnb2JqZWN0SWQnXSA9IHtcbiAgICAgICAgICAgICAgICAkbmU6IGlkTWF0Y2gub2JqZWN0SWQsXG4gICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAvLyBXaGF0IHRvIGRvIGhlcmU/IGNhbid0IHJlYWxseSBjbGVhbiB1cCBldmVyeXRoaW5nLi4uXG4gICAgICAgICAgICAgIHJldHVybiBpZE1hdGNoLm9iamVjdElkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRoaXMuZGF0YS5hcHBJZGVudGlmaWVyKSB7XG4gICAgICAgICAgICAgIGRlbFF1ZXJ5WydhcHBJZGVudGlmaWVyJ10gPSB0aGlzLmRhdGEuYXBwSWRlbnRpZmllcjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMuY29uZmlnLmRhdGFiYXNlXG4gICAgICAgICAgICAgIC5kZXN0cm95KCdfSW5zdGFsbGF0aW9uJywgZGVsUXVlcnkpXG4gICAgICAgICAgICAgIC5jYXRjaChlcnIgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChlcnIuY29kZSA9PSBQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5EKSB7XG4gICAgICAgICAgICAgICAgICAvLyBubyBkZWxldGlvbnMgd2VyZSBtYWRlLiBDYW4gYmUgaWdub3JlZC5cbiAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgLy8gcmV0aHJvdyB0aGUgZXJyb3JcbiAgICAgICAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBJbiBub24tbWVyZ2Ugc2NlbmFyaW9zLCBqdXN0IHJldHVybiB0aGUgaW5zdGFsbGF0aW9uIG1hdGNoIGlkXG4gICAgICAgICAgcmV0dXJuIGlkTWF0Y2gub2JqZWN0SWQ7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KVxuICAgIC50aGVuKG9iaklkID0+IHtcbiAgICAgIGlmIChvYmpJZCkge1xuICAgICAgICB0aGlzLnF1ZXJ5ID0geyBvYmplY3RJZDogb2JqSWQgfTtcbiAgICAgICAgZGVsZXRlIHRoaXMuZGF0YS5vYmplY3RJZDtcbiAgICAgICAgZGVsZXRlIHRoaXMuZGF0YS5jcmVhdGVkQXQ7XG4gICAgICB9XG4gICAgICAvLyBUT0RPOiBWYWxpZGF0ZSBvcHMgKGFkZC9yZW1vdmUgb24gY2hhbm5lbHMsICRpbmMgb24gYmFkZ2UsIGV0Yy4pXG4gICAgfSk7XG4gIHJldHVybiBwcm9taXNlO1xufTtcblxuLy8gSWYgd2Ugc2hvcnQtY2lyY3V0ZWQgdGhlIG9iamVjdCByZXNwb25zZSAtIHRoZW4gd2UgbmVlZCB0byBtYWtlIHN1cmUgd2UgZXhwYW5kIGFsbCB0aGUgZmlsZXMsXG4vLyBzaW5jZSB0aGlzIG1pZ2h0IG5vdCBoYXZlIGEgcXVlcnksIG1lYW5pbmcgaXQgd29uJ3QgcmV0dXJuIHRoZSBmdWxsIHJlc3VsdCBiYWNrLlxuLy8gVE9ETzogKG5sdXRzZW5rbykgVGhpcyBzaG91bGQgZGllIHdoZW4gd2UgbW92ZSB0byBwZXItY2xhc3MgYmFzZWQgY29udHJvbGxlcnMgb24gX1Nlc3Npb24vX1VzZXJcblJlc3RXcml0ZS5wcm90b3R5cGUuZXhwYW5kRmlsZXNGb3JFeGlzdGluZ09iamVjdHMgPSBmdW5jdGlvbigpIHtcbiAgLy8gQ2hlY2sgd2hldGhlciB3ZSBoYXZlIGEgc2hvcnQtY2lyY3VpdGVkIHJlc3BvbnNlIC0gb25seSB0aGVuIHJ1biBleHBhbnNpb24uXG4gIGlmICh0aGlzLnJlc3BvbnNlICYmIHRoaXMucmVzcG9uc2UucmVzcG9uc2UpIHtcbiAgICB0aGlzLmNvbmZpZy5maWxlc0NvbnRyb2xsZXIuZXhwYW5kRmlsZXNJbk9iamVjdChcbiAgICAgIHRoaXMuY29uZmlnLFxuICAgICAgdGhpcy5yZXNwb25zZS5yZXNwb25zZVxuICAgICk7XG4gIH1cbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUucnVuRGF0YWJhc2VPcGVyYXRpb24gPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMucmVzcG9uc2UpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAodGhpcy5jbGFzc05hbWUgPT09ICdfUm9sZScpIHtcbiAgICB0aGlzLmNvbmZpZy5jYWNoZUNvbnRyb2xsZXIucm9sZS5jbGVhcigpO1xuICB9XG5cbiAgaWYgKFxuICAgIHRoaXMuY2xhc3NOYW1lID09PSAnX1VzZXInICYmXG4gICAgdGhpcy5xdWVyeSAmJlxuICAgIHRoaXMuYXV0aC5pc1VuYXV0aGVudGljYXRlZCgpXG4gICkge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLlNFU1NJT05fTUlTU0lORyxcbiAgICAgIGBDYW5ub3QgbW9kaWZ5IHVzZXIgJHt0aGlzLnF1ZXJ5Lm9iamVjdElkfS5gXG4gICAgKTtcbiAgfVxuXG4gIGlmICh0aGlzLmNsYXNzTmFtZSA9PT0gJ19Qcm9kdWN0JyAmJiB0aGlzLmRhdGEuZG93bmxvYWQpIHtcbiAgICB0aGlzLmRhdGEuZG93bmxvYWROYW1lID0gdGhpcy5kYXRhLmRvd25sb2FkLm5hbWU7XG4gIH1cblxuICAvLyBUT0RPOiBBZGQgYmV0dGVyIGRldGVjdGlvbiBmb3IgQUNMLCBlbnN1cmluZyBhIHVzZXIgY2FuJ3QgYmUgbG9ja2VkIGZyb21cbiAgLy8gICAgICAgdGhlaXIgb3duIHVzZXIgcmVjb3JkLlxuICBpZiAodGhpcy5kYXRhLkFDTCAmJiB0aGlzLmRhdGEuQUNMWycqdW5yZXNvbHZlZCddKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfQUNMLCAnSW52YWxpZCBBQ0wuJyk7XG4gIH1cblxuICBpZiAodGhpcy5xdWVyeSkge1xuICAgIC8vIEZvcmNlIHRoZSB1c2VyIHRvIG5vdCBsb2Nrb3V0XG4gICAgLy8gTWF0Y2hlZCB3aXRoIHBhcnNlLmNvbVxuICAgIGlmIChcbiAgICAgIHRoaXMuY2xhc3NOYW1lID09PSAnX1VzZXInICYmXG4gICAgICB0aGlzLmRhdGEuQUNMICYmXG4gICAgICB0aGlzLmF1dGguaXNNYXN0ZXIgIT09IHRydWVcbiAgICApIHtcbiAgICAgIHRoaXMuZGF0YS5BQ0xbdGhpcy5xdWVyeS5vYmplY3RJZF0gPSB7IHJlYWQ6IHRydWUsIHdyaXRlOiB0cnVlIH07XG4gICAgfVxuICAgIC8vIHVwZGF0ZSBwYXNzd29yZCB0aW1lc3RhbXAgaWYgdXNlciBwYXNzd29yZCBpcyBiZWluZyBjaGFuZ2VkXG4gICAgaWYgKFxuICAgICAgdGhpcy5jbGFzc05hbWUgPT09ICdfVXNlcicgJiZcbiAgICAgIHRoaXMuZGF0YS5faGFzaGVkX3Bhc3N3b3JkICYmXG4gICAgICB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeSAmJlxuICAgICAgdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRBZ2VcbiAgICApIHtcbiAgICAgIHRoaXMuZGF0YS5fcGFzc3dvcmRfY2hhbmdlZF9hdCA9IFBhcnNlLl9lbmNvZGUobmV3IERhdGUoKSk7XG4gICAgfVxuICAgIC8vIElnbm9yZSBjcmVhdGVkQXQgd2hlbiB1cGRhdGVcbiAgICBkZWxldGUgdGhpcy5kYXRhLmNyZWF0ZWRBdDtcblxuICAgIGxldCBkZWZlciA9IFByb21pc2UucmVzb2x2ZSgpO1xuICAgIC8vIGlmIHBhc3N3b3JkIGhpc3RvcnkgaXMgZW5hYmxlZCB0aGVuIHNhdmUgdGhlIGN1cnJlbnQgcGFzc3dvcmQgdG8gaGlzdG9yeVxuICAgIGlmIChcbiAgICAgIHRoaXMuY2xhc3NOYW1lID09PSAnX1VzZXInICYmXG4gICAgICB0aGlzLmRhdGEuX2hhc2hlZF9wYXNzd29yZCAmJlxuICAgICAgdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kgJiZcbiAgICAgIHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5Lm1heFBhc3N3b3JkSGlzdG9yeVxuICAgICkge1xuICAgICAgZGVmZXIgPSB0aGlzLmNvbmZpZy5kYXRhYmFzZVxuICAgICAgICAuZmluZChcbiAgICAgICAgICAnX1VzZXInLFxuICAgICAgICAgIHsgb2JqZWN0SWQ6IHRoaXMub2JqZWN0SWQoKSB9LFxuICAgICAgICAgIHsga2V5czogWydfcGFzc3dvcmRfaGlzdG9yeScsICdfaGFzaGVkX3Bhc3N3b3JkJ10gfVxuICAgICAgICApXG4gICAgICAgIC50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgICAgIGlmIChyZXN1bHRzLmxlbmd0aCAhPSAxKSB7XG4gICAgICAgICAgICB0aHJvdyB1bmRlZmluZWQ7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IHVzZXIgPSByZXN1bHRzWzBdO1xuICAgICAgICAgIGxldCBvbGRQYXNzd29yZHMgPSBbXTtcbiAgICAgICAgICBpZiAodXNlci5fcGFzc3dvcmRfaGlzdG9yeSkge1xuICAgICAgICAgICAgb2xkUGFzc3dvcmRzID0gXy50YWtlKFxuICAgICAgICAgICAgICB1c2VyLl9wYXNzd29yZF9oaXN0b3J5LFxuICAgICAgICAgICAgICB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5tYXhQYXNzd29yZEhpc3RvcnlcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vbi0xIHBhc3N3b3JkcyBnbyBpbnRvIGhpc3RvcnkgaW5jbHVkaW5nIGxhc3QgcGFzc3dvcmRcbiAgICAgICAgICB3aGlsZSAoXG4gICAgICAgICAgICBvbGRQYXNzd29yZHMubGVuZ3RoID5cbiAgICAgICAgICAgIHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5Lm1heFBhc3N3b3JkSGlzdG9yeSAtIDJcbiAgICAgICAgICApIHtcbiAgICAgICAgICAgIG9sZFBhc3N3b3Jkcy5zaGlmdCgpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBvbGRQYXNzd29yZHMucHVzaCh1c2VyLnBhc3N3b3JkKTtcbiAgICAgICAgICB0aGlzLmRhdGEuX3Bhc3N3b3JkX2hpc3RvcnkgPSBvbGRQYXNzd29yZHM7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBkZWZlci50aGVuKCgpID0+IHtcbiAgICAgIC8vIFJ1biBhbiB1cGRhdGVcbiAgICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZVxuICAgICAgICAudXBkYXRlKHRoaXMuY2xhc3NOYW1lLCB0aGlzLnF1ZXJ5LCB0aGlzLmRhdGEsIHRoaXMucnVuT3B0aW9ucylcbiAgICAgICAgLnRoZW4ocmVzcG9uc2UgPT4ge1xuICAgICAgICAgIHJlc3BvbnNlLnVwZGF0ZWRBdCA9IHRoaXMudXBkYXRlZEF0O1xuICAgICAgICAgIHRoaXMuX3VwZGF0ZVJlc3BvbnNlV2l0aERhdGEocmVzcG9uc2UsIHRoaXMuZGF0YSk7XG4gICAgICAgICAgdGhpcy5yZXNwb25zZSA9IHsgcmVzcG9uc2UgfTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgLy8gU2V0IHRoZSBkZWZhdWx0IEFDTCBhbmQgcGFzc3dvcmQgdGltZXN0YW1wIGZvciB0aGUgbmV3IF9Vc2VyXG4gICAgaWYgKHRoaXMuY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgICB2YXIgQUNMID0gdGhpcy5kYXRhLkFDTDtcbiAgICAgIC8vIGRlZmF1bHQgcHVibGljIHIvdyBBQ0xcbiAgICAgIGlmICghQUNMKSB7XG4gICAgICAgIEFDTCA9IHt9O1xuICAgICAgICBBQ0xbJyonXSA9IHsgcmVhZDogdHJ1ZSwgd3JpdGU6IGZhbHNlIH07XG4gICAgICB9XG4gICAgICAvLyBtYWtlIHN1cmUgdGhlIHVzZXIgaXMgbm90IGxvY2tlZCBkb3duXG4gICAgICBBQ0xbdGhpcy5kYXRhLm9iamVjdElkXSA9IHsgcmVhZDogdHJ1ZSwgd3JpdGU6IHRydWUgfTtcbiAgICAgIHRoaXMuZGF0YS5BQ0wgPSBBQ0w7XG4gICAgICAvLyBwYXNzd29yZCB0aW1lc3RhbXAgdG8gYmUgdXNlZCB3aGVuIHBhc3N3b3JkIGV4cGlyeSBwb2xpY3kgaXMgZW5mb3JjZWRcbiAgICAgIGlmIChcbiAgICAgICAgdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kgJiZcbiAgICAgICAgdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRBZ2VcbiAgICAgICkge1xuICAgICAgICB0aGlzLmRhdGEuX3Bhc3N3b3JkX2NoYW5nZWRfYXQgPSBQYXJzZS5fZW5jb2RlKG5ldyBEYXRlKCkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFJ1biBhIGNyZWF0ZVxuICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZVxuICAgICAgLmNyZWF0ZSh0aGlzLmNsYXNzTmFtZSwgdGhpcy5kYXRhLCB0aGlzLnJ1bk9wdGlvbnMpXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoXG4gICAgICAgICAgdGhpcy5jbGFzc05hbWUgIT09ICdfVXNlcicgfHxcbiAgICAgICAgICBlcnJvci5jb2RlICE9PSBQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUVcbiAgICAgICAgKSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBRdWljayBjaGVjaywgaWYgd2Ugd2VyZSBhYmxlIHRvIGluZmVyIHRoZSBkdXBsaWNhdGVkIGZpZWxkIG5hbWVcbiAgICAgICAgaWYgKFxuICAgICAgICAgIGVycm9yICYmXG4gICAgICAgICAgZXJyb3IudXNlckluZm8gJiZcbiAgICAgICAgICBlcnJvci51c2VySW5mby5kdXBsaWNhdGVkX2ZpZWxkID09PSAndXNlcm5hbWUnXG4gICAgICAgICkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLlVTRVJOQU1FX1RBS0VOLFxuICAgICAgICAgICAgJ0FjY291bnQgYWxyZWFkeSBleGlzdHMgZm9yIHRoaXMgdXNlcm5hbWUuJ1xuICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoXG4gICAgICAgICAgZXJyb3IgJiZcbiAgICAgICAgICBlcnJvci51c2VySW5mbyAmJlxuICAgICAgICAgIGVycm9yLnVzZXJJbmZvLmR1cGxpY2F0ZWRfZmllbGQgPT09ICdlbWFpbCdcbiAgICAgICAgKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuRU1BSUxfVEFLRU4sXG4gICAgICAgICAgICAnQWNjb3VudCBhbHJlYWR5IGV4aXN0cyBmb3IgdGhpcyBlbWFpbCBhZGRyZXNzLidcbiAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gSWYgdGhpcyB3YXMgYSBmYWlsZWQgdXNlciBjcmVhdGlvbiBkdWUgdG8gdXNlcm5hbWUgb3IgZW1haWwgYWxyZWFkeSB0YWtlbiwgd2UgbmVlZCB0b1xuICAgICAgICAvLyBjaGVjayB3aGV0aGVyIGl0IHdhcyB1c2VybmFtZSBvciBlbWFpbCBhbmQgcmV0dXJuIHRoZSBhcHByb3ByaWF0ZSBlcnJvci5cbiAgICAgICAgLy8gRmFsbGJhY2sgdG8gdGhlIG9yaWdpbmFsIG1ldGhvZFxuICAgICAgICAvLyBUT0RPOiBTZWUgaWYgd2UgY2FuIGxhdGVyIGRvIHRoaXMgd2l0aG91dCBhZGRpdGlvbmFsIHF1ZXJpZXMgYnkgdXNpbmcgbmFtZWQgaW5kZXhlcy5cbiAgICAgICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlXG4gICAgICAgICAgLmZpbmQoXG4gICAgICAgICAgICB0aGlzLmNsYXNzTmFtZSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgdXNlcm5hbWU6IHRoaXMuZGF0YS51c2VybmFtZSxcbiAgICAgICAgICAgICAgb2JqZWN0SWQ6IHsgJG5lOiB0aGlzLm9iamVjdElkKCkgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7IGxpbWl0OiAxIH1cbiAgICAgICAgICApXG4gICAgICAgICAgLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICAgICAgICBpZiAocmVzdWx0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgICBQYXJzZS5FcnJvci5VU0VSTkFNRV9UQUtFTixcbiAgICAgICAgICAgICAgICAnQWNjb3VudCBhbHJlYWR5IGV4aXN0cyBmb3IgdGhpcyB1c2VybmFtZS4nXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UuZmluZChcbiAgICAgICAgICAgICAgdGhpcy5jbGFzc05hbWUsXG4gICAgICAgICAgICAgIHsgZW1haWw6IHRoaXMuZGF0YS5lbWFpbCwgb2JqZWN0SWQ6IHsgJG5lOiB0aGlzLm9iamVjdElkKCkgfSB9LFxuICAgICAgICAgICAgICB7IGxpbWl0OiAxIH1cbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAudGhlbihyZXN1bHRzID0+IHtcbiAgICAgICAgICAgIGlmIChyZXN1bHRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICAgIFBhcnNlLkVycm9yLkVNQUlMX1RBS0VOLFxuICAgICAgICAgICAgICAgICdBY2NvdW50IGFscmVhZHkgZXhpc3RzIGZvciB0aGlzIGVtYWlsIGFkZHJlc3MuJ1xuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICBQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUsXG4gICAgICAgICAgICAgICdBIGR1cGxpY2F0ZSB2YWx1ZSBmb3IgYSBmaWVsZCB3aXRoIHVuaXF1ZSB2YWx1ZXMgd2FzIHByb3ZpZGVkJ1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9KTtcbiAgICAgIH0pXG4gICAgICAudGhlbihyZXNwb25zZSA9PiB7XG4gICAgICAgIHJlc3BvbnNlLm9iamVjdElkID0gdGhpcy5kYXRhLm9iamVjdElkO1xuICAgICAgICByZXNwb25zZS5jcmVhdGVkQXQgPSB0aGlzLmRhdGEuY3JlYXRlZEF0O1xuXG4gICAgICAgIGlmICh0aGlzLnJlc3BvbnNlU2hvdWxkSGF2ZVVzZXJuYW1lKSB7XG4gICAgICAgICAgcmVzcG9uc2UudXNlcm5hbWUgPSB0aGlzLmRhdGEudXNlcm5hbWU7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fdXBkYXRlUmVzcG9uc2VXaXRoRGF0YShyZXNwb25zZSwgdGhpcy5kYXRhKTtcbiAgICAgICAgdGhpcy5yZXNwb25zZSA9IHtcbiAgICAgICAgICBzdGF0dXM6IDIwMSxcbiAgICAgICAgICByZXNwb25zZSxcbiAgICAgICAgICBsb2NhdGlvbjogdGhpcy5sb2NhdGlvbigpLFxuICAgICAgICB9O1xuICAgICAgfSk7XG4gIH1cbn07XG5cbi8vIFJldHVybnMgbm90aGluZyAtIGRvZXNuJ3Qgd2FpdCBmb3IgdGhlIHRyaWdnZXIuXG5SZXN0V3JpdGUucHJvdG90eXBlLnJ1bkFmdGVyVHJpZ2dlciA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMucmVzcG9uc2UgfHwgIXRoaXMucmVzcG9uc2UucmVzcG9uc2UpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBBdm9pZCBkb2luZyBhbnkgc2V0dXAgZm9yIHRyaWdnZXJzIGlmIHRoZXJlIGlzIG5vICdhZnRlclNhdmUnIHRyaWdnZXIgZm9yIHRoaXMgY2xhc3MuXG4gIGNvbnN0IGhhc0FmdGVyU2F2ZUhvb2sgPSB0cmlnZ2Vycy50cmlnZ2VyRXhpc3RzKFxuICAgIHRoaXMuY2xhc3NOYW1lLFxuICAgIHRyaWdnZXJzLlR5cGVzLmFmdGVyU2F2ZSxcbiAgICB0aGlzLmNvbmZpZy5hcHBsaWNhdGlvbklkXG4gICk7XG4gIGNvbnN0IGhhc0xpdmVRdWVyeSA9IHRoaXMuY29uZmlnLmxpdmVRdWVyeUNvbnRyb2xsZXIuaGFzTGl2ZVF1ZXJ5KFxuICAgIHRoaXMuY2xhc3NOYW1lXG4gICk7XG4gIGlmICghaGFzQWZ0ZXJTYXZlSG9vayAmJiAhaGFzTGl2ZVF1ZXJ5KSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgdmFyIGV4dHJhRGF0YSA9IHsgY2xhc3NOYW1lOiB0aGlzLmNsYXNzTmFtZSB9O1xuICBpZiAodGhpcy5xdWVyeSAmJiB0aGlzLnF1ZXJ5Lm9iamVjdElkKSB7XG4gICAgZXh0cmFEYXRhLm9iamVjdElkID0gdGhpcy5xdWVyeS5vYmplY3RJZDtcbiAgfVxuXG4gIC8vIEJ1aWxkIHRoZSBvcmlnaW5hbCBvYmplY3QsIHdlIG9ubHkgZG8gdGhpcyBmb3IgYSB1cGRhdGUgd3JpdGUuXG4gIGxldCBvcmlnaW5hbE9iamVjdDtcbiAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5xdWVyeS5vYmplY3RJZCkge1xuICAgIG9yaWdpbmFsT2JqZWN0ID0gdHJpZ2dlcnMuaW5mbGF0ZShleHRyYURhdGEsIHRoaXMub3JpZ2luYWxEYXRhKTtcbiAgfVxuXG4gIC8vIEJ1aWxkIHRoZSBpbmZsYXRlZCBvYmplY3QsIGRpZmZlcmVudCBmcm9tIGJlZm9yZVNhdmUsIG9yaWdpbmFsRGF0YSBpcyBub3QgZW1wdHlcbiAgLy8gc2luY2UgZGV2ZWxvcGVycyBjYW4gY2hhbmdlIGRhdGEgaW4gdGhlIGJlZm9yZVNhdmUuXG4gIGNvbnN0IHVwZGF0ZWRPYmplY3QgPSB0aGlzLmJ1aWxkVXBkYXRlZE9iamVjdChleHRyYURhdGEpO1xuICB1cGRhdGVkT2JqZWN0Ll9oYW5kbGVTYXZlUmVzcG9uc2UoXG4gICAgdGhpcy5yZXNwb25zZS5yZXNwb25zZSxcbiAgICB0aGlzLnJlc3BvbnNlLnN0YXR1cyB8fCAyMDBcbiAgKTtcblxuICB0aGlzLmNvbmZpZy5kYXRhYmFzZS5sb2FkU2NoZW1hKCkudGhlbihzY2hlbWFDb250cm9sbGVyID0+IHtcbiAgICAvLyBOb3RpZml5IExpdmVRdWVyeVNlcnZlciBpZiBwb3NzaWJsZVxuICAgIGNvbnN0IHBlcm1zID0gc2NoZW1hQ29udHJvbGxlci5nZXRDbGFzc0xldmVsUGVybWlzc2lvbnMoXG4gICAgICB1cGRhdGVkT2JqZWN0LmNsYXNzTmFtZVxuICAgICk7XG4gICAgdGhpcy5jb25maWcubGl2ZVF1ZXJ5Q29udHJvbGxlci5vbkFmdGVyU2F2ZShcbiAgICAgIHVwZGF0ZWRPYmplY3QuY2xhc3NOYW1lLFxuICAgICAgdXBkYXRlZE9iamVjdCxcbiAgICAgIG9yaWdpbmFsT2JqZWN0LFxuICAgICAgcGVybXNcbiAgICApO1xuICB9KTtcblxuICAvLyBSdW4gYWZ0ZXJTYXZlIHRyaWdnZXJcbiAgcmV0dXJuIHRyaWdnZXJzXG4gICAgLm1heWJlUnVuVHJpZ2dlcihcbiAgICAgIHRyaWdnZXJzLlR5cGVzLmFmdGVyU2F2ZSxcbiAgICAgIHRoaXMuYXV0aCxcbiAgICAgIHVwZGF0ZWRPYmplY3QsXG4gICAgICBvcmlnaW5hbE9iamVjdCxcbiAgICAgIHRoaXMuY29uZmlnLFxuICAgICAgdGhpcy5jb250ZXh0XG4gICAgKVxuICAgIC5jYXRjaChmdW5jdGlvbihlcnIpIHtcbiAgICAgIGxvZ2dlci53YXJuKCdhZnRlclNhdmUgY2F1Z2h0IGFuIGVycm9yJywgZXJyKTtcbiAgICB9KTtcbn07XG5cbi8vIEEgaGVscGVyIHRvIGZpZ3VyZSBvdXQgd2hhdCBsb2NhdGlvbiB0aGlzIG9wZXJhdGlvbiBoYXBwZW5zIGF0LlxuUmVzdFdyaXRlLnByb3RvdHlwZS5sb2NhdGlvbiA9IGZ1bmN0aW9uKCkge1xuICB2YXIgbWlkZGxlID1cbiAgICB0aGlzLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJyA/ICcvdXNlcnMvJyA6ICcvY2xhc3Nlcy8nICsgdGhpcy5jbGFzc05hbWUgKyAnLyc7XG4gIHJldHVybiB0aGlzLmNvbmZpZy5tb3VudCArIG1pZGRsZSArIHRoaXMuZGF0YS5vYmplY3RJZDtcbn07XG5cbi8vIEEgaGVscGVyIHRvIGdldCB0aGUgb2JqZWN0IGlkIGZvciB0aGlzIG9wZXJhdGlvbi5cbi8vIEJlY2F1c2UgaXQgY291bGQgYmUgZWl0aGVyIG9uIHRoZSBxdWVyeSBvciBvbiB0aGUgZGF0YVxuUmVzdFdyaXRlLnByb3RvdHlwZS5vYmplY3RJZCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5kYXRhLm9iamVjdElkIHx8IHRoaXMucXVlcnkub2JqZWN0SWQ7XG59O1xuXG4vLyBSZXR1cm5zIGEgY29weSBvZiB0aGUgZGF0YSBhbmQgZGVsZXRlIGJhZCBrZXlzIChfYXV0aF9kYXRhLCBfaGFzaGVkX3Bhc3N3b3JkLi4uKVxuUmVzdFdyaXRlLnByb3RvdHlwZS5zYW5pdGl6ZWREYXRhID0gZnVuY3Rpb24oKSB7XG4gIGNvbnN0IGRhdGEgPSBPYmplY3Qua2V5cyh0aGlzLmRhdGEpLnJlZHVjZSgoZGF0YSwga2V5KSA9PiB7XG4gICAgLy8gUmVnZXhwIGNvbWVzIGZyb20gUGFyc2UuT2JqZWN0LnByb3RvdHlwZS52YWxpZGF0ZVxuICAgIGlmICghL15bQS1aYS16XVswLTlBLVphLXpfXSokLy50ZXN0KGtleSkpIHtcbiAgICAgIGRlbGV0ZSBkYXRhW2tleV07XG4gICAgfVxuICAgIHJldHVybiBkYXRhO1xuICB9LCBkZWVwY29weSh0aGlzLmRhdGEpKTtcbiAgcmV0dXJuIFBhcnNlLl9kZWNvZGUodW5kZWZpbmVkLCBkYXRhKTtcbn07XG5cbi8vIFJldHVybnMgYW4gdXBkYXRlZCBjb3B5IG9mIHRoZSBvYmplY3RcblJlc3RXcml0ZS5wcm90b3R5cGUuYnVpbGRVcGRhdGVkT2JqZWN0ID0gZnVuY3Rpb24oZXh0cmFEYXRhKSB7XG4gIGNvbnN0IHVwZGF0ZWRPYmplY3QgPSB0cmlnZ2Vycy5pbmZsYXRlKGV4dHJhRGF0YSwgdGhpcy5vcmlnaW5hbERhdGEpO1xuICBPYmplY3Qua2V5cyh0aGlzLmRhdGEpLnJlZHVjZShmdW5jdGlvbihkYXRhLCBrZXkpIHtcbiAgICBpZiAoa2V5LmluZGV4T2YoJy4nKSA+IDApIHtcbiAgICAgIC8vIHN1YmRvY3VtZW50IGtleSB3aXRoIGRvdCBub3RhdGlvbiAoJ3gueSc6diA9PiAneCc6eyd5Jzp2fSlcbiAgICAgIGNvbnN0IHNwbGl0dGVkS2V5ID0ga2V5LnNwbGl0KCcuJyk7XG4gICAgICBjb25zdCBwYXJlbnRQcm9wID0gc3BsaXR0ZWRLZXlbMF07XG4gICAgICBsZXQgcGFyZW50VmFsID0gdXBkYXRlZE9iamVjdC5nZXQocGFyZW50UHJvcCk7XG4gICAgICBpZiAodHlwZW9mIHBhcmVudFZhbCAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgcGFyZW50VmFsID0ge307XG4gICAgICB9XG4gICAgICBwYXJlbnRWYWxbc3BsaXR0ZWRLZXlbMV1dID0gZGF0YVtrZXldO1xuICAgICAgdXBkYXRlZE9iamVjdC5zZXQocGFyZW50UHJvcCwgcGFyZW50VmFsKTtcbiAgICAgIGRlbGV0ZSBkYXRhW2tleV07XG4gICAgfVxuICAgIHJldHVybiBkYXRhO1xuICB9LCBkZWVwY29weSh0aGlzLmRhdGEpKTtcblxuICB1cGRhdGVkT2JqZWN0LnNldCh0aGlzLnNhbml0aXplZERhdGEoKSk7XG4gIHJldHVybiB1cGRhdGVkT2JqZWN0O1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5jbGVhblVzZXJBdXRoRGF0YSA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5yZXNwb25zZSAmJiB0aGlzLnJlc3BvbnNlLnJlc3BvbnNlICYmIHRoaXMuY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgY29uc3QgdXNlciA9IHRoaXMucmVzcG9uc2UucmVzcG9uc2U7XG4gICAgaWYgKHVzZXIuYXV0aERhdGEpIHtcbiAgICAgIE9iamVjdC5rZXlzKHVzZXIuYXV0aERhdGEpLmZvckVhY2gocHJvdmlkZXIgPT4ge1xuICAgICAgICBpZiAodXNlci5hdXRoRGF0YVtwcm92aWRlcl0gPT09IG51bGwpIHtcbiAgICAgICAgICBkZWxldGUgdXNlci5hdXRoRGF0YVtwcm92aWRlcl07XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgaWYgKE9iamVjdC5rZXlzKHVzZXIuYXV0aERhdGEpLmxlbmd0aCA9PSAwKSB7XG4gICAgICAgIGRlbGV0ZSB1c2VyLmF1dGhEYXRhO1xuICAgICAgfVxuICAgIH1cbiAgfVxufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5fdXBkYXRlUmVzcG9uc2VXaXRoRGF0YSA9IGZ1bmN0aW9uKHJlc3BvbnNlLCBkYXRhKSB7XG4gIGlmIChfLmlzRW1wdHkodGhpcy5zdG9yYWdlLmZpZWxkc0NoYW5nZWRCeVRyaWdnZXIpKSB7XG4gICAgcmV0dXJuIHJlc3BvbnNlO1xuICB9XG4gIGNvbnN0IGNsaWVudFN1cHBvcnRzRGVsZXRlID0gQ2xpZW50U0RLLnN1cHBvcnRzRm9yd2FyZERlbGV0ZSh0aGlzLmNsaWVudFNESyk7XG4gIHRoaXMuc3RvcmFnZS5maWVsZHNDaGFuZ2VkQnlUcmlnZ2VyLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICBjb25zdCBkYXRhVmFsdWUgPSBkYXRhW2ZpZWxkTmFtZV07XG5cbiAgICBpZiAoIXJlc3BvbnNlLmhhc093blByb3BlcnR5KGZpZWxkTmFtZSkpIHtcbiAgICAgIHJlc3BvbnNlW2ZpZWxkTmFtZV0gPSBkYXRhVmFsdWU7XG4gICAgfVxuXG4gICAgLy8gU3RyaXBzIG9wZXJhdGlvbnMgZnJvbSByZXNwb25zZXNcbiAgICBpZiAocmVzcG9uc2VbZmllbGROYW1lXSAmJiByZXNwb25zZVtmaWVsZE5hbWVdLl9fb3ApIHtcbiAgICAgIGRlbGV0ZSByZXNwb25zZVtmaWVsZE5hbWVdO1xuICAgICAgaWYgKGNsaWVudFN1cHBvcnRzRGVsZXRlICYmIGRhdGFWYWx1ZS5fX29wID09ICdEZWxldGUnKSB7XG4gICAgICAgIHJlc3BvbnNlW2ZpZWxkTmFtZV0gPSBkYXRhVmFsdWU7XG4gICAgICB9XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIHJlc3BvbnNlO1xufTtcblxuZXhwb3J0IGRlZmF1bHQgUmVzdFdyaXRlO1xubW9kdWxlLmV4cG9ydHMgPSBSZXN0V3JpdGU7XG4iXX0=