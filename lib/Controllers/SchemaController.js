"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.classNameIsValid = classNameIsValid;
exports.fieldNameIsValid = fieldNameIsValid;
exports.invalidClassNameMessage = invalidClassNameMessage;
exports.buildMergedSchemaObject = buildMergedSchemaObject;
exports.VolatileClassesSchemas = exports.convertSchemaToAdapterSchema = exports.defaultColumns = exports.systemClasses = exports.load = exports.SchemaController = exports.default = void 0;

var _StorageAdapter = require("../Adapters/Storage/StorageAdapter");

var _DatabaseController = _interopRequireDefault(require("./DatabaseController"));

var _Config = _interopRequireDefault(require("../Config"));

var _deepcopy = _interopRequireDefault(require("deepcopy"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; var ownKeys = Object.keys(source); if (typeof Object.getOwnPropertySymbols === 'function') { ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function (sym) { return Object.getOwnPropertyDescriptor(source, sym).enumerable; })); } ownKeys.forEach(function (key) { _defineProperty(target, key, source[key]); }); } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

function _extends() { _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }

// This class handles schema validation, persistence, and modification.
//
// Each individual Schema object should be immutable. The helpers to
// do things with the Schema just return a new schema when the schema
// is changed.
//
// The canonical place to store this Schema is in the database itself,
// in a _SCHEMA collection. This is not the right way to do it for an
// open source framework, but it's backward compatible, so we're
// keeping it this way for now.
//
// In API-handling code, you should only use the Schema class via the
// DatabaseController. This will let us replace the schema logic for
// different databases.
// TODO: hide all schema logic inside the database adapter.
// -disable-next
const Parse = require('parse/node').Parse;

const defaultColumns = Object.freeze({
  // Contain the default columns for every parse object type (except _Join collection)
  _Default: {
    objectId: {
      type: 'String'
    },
    createdAt: {
      type: 'Date'
    },
    updatedAt: {
      type: 'Date'
    },
    ACL: {
      type: 'ACL'
    }
  },
  // The additional default columns for the _User collection (in addition to DefaultCols)
  _User: {
    username: {
      type: 'String'
    },
    password: {
      type: 'String'
    },
    email: {
      type: 'String'
    },
    emailVerified: {
      type: 'Boolean'
    },
    authData: {
      type: 'Object'
    }
  },
  // The additional default columns for the _Installation collection (in addition to DefaultCols)
  _Installation: {
    installationId: {
      type: 'String'
    },
    deviceToken: {
      type: 'String'
    },
    channels: {
      type: 'Array'
    },
    deviceType: {
      type: 'String'
    },
    pushType: {
      type: 'String'
    },
    GCMSenderId: {
      type: 'String'
    },
    timeZone: {
      type: 'String'
    },
    localeIdentifier: {
      type: 'String'
    },
    badge: {
      type: 'Number'
    },
    appVersion: {
      type: 'String'
    },
    appName: {
      type: 'String'
    },
    appIdentifier: {
      type: 'String'
    },
    parseVersion: {
      type: 'String'
    }
  },
  // The additional default columns for the _Role collection (in addition to DefaultCols)
  _Role: {
    name: {
      type: 'String'
    },
    users: {
      type: 'Relation',
      targetClass: '_User'
    },
    roles: {
      type: 'Relation',
      targetClass: '_Role'
    }
  },
  // The additional default columns for the _Session collection (in addition to DefaultCols)
  _Session: {
    restricted: {
      type: 'Boolean'
    },
    user: {
      type: 'Pointer',
      targetClass: '_User'
    },
    installationId: {
      type: 'String'
    },
    sessionToken: {
      type: 'String'
    },
    expiresAt: {
      type: 'Date'
    },
    createdWith: {
      type: 'Object'
    }
  },
  _Product: {
    productIdentifier: {
      type: 'String'
    },
    download: {
      type: 'File'
    },
    downloadName: {
      type: 'String'
    },
    icon: {
      type: 'File'
    },
    order: {
      type: 'Number'
    },
    title: {
      type: 'String'
    },
    subtitle: {
      type: 'String'
    }
  },
  _PushStatus: {
    pushTime: {
      type: 'String'
    },
    source: {
      type: 'String'
    },
    // rest or webui
    query: {
      type: 'String'
    },
    // the stringified JSON query
    payload: {
      type: 'String'
    },
    // the stringified JSON payload,
    title: {
      type: 'String'
    },
    expiry: {
      type: 'Number'
    },
    expiration_interval: {
      type: 'Number'
    },
    status: {
      type: 'String'
    },
    numSent: {
      type: 'Number'
    },
    numFailed: {
      type: 'Number'
    },
    pushHash: {
      type: 'String'
    },
    errorMessage: {
      type: 'Object'
    },
    sentPerType: {
      type: 'Object'
    },
    failedPerType: {
      type: 'Object'
    },
    sentPerUTCOffset: {
      type: 'Object'
    },
    failedPerUTCOffset: {
      type: 'Object'
    },
    count: {
      type: 'Number'
    } // tracks # of batches queued and pending

  },
  _JobStatus: {
    jobName: {
      type: 'String'
    },
    source: {
      type: 'String'
    },
    status: {
      type: 'String'
    },
    message: {
      type: 'String'
    },
    params: {
      type: 'Object'
    },
    // params received when calling the job
    finishedAt: {
      type: 'Date'
    }
  },
  _JobSchedule: {
    jobName: {
      type: 'String'
    },
    description: {
      type: 'String'
    },
    params: {
      type: 'String'
    },
    startAfter: {
      type: 'String'
    },
    daysOfWeek: {
      type: 'Array'
    },
    timeOfDay: {
      type: 'String'
    },
    lastRun: {
      type: 'Number'
    },
    repeatMinutes: {
      type: 'Number'
    }
  },
  _Hooks: {
    functionName: {
      type: 'String'
    },
    className: {
      type: 'String'
    },
    triggerName: {
      type: 'String'
    },
    url: {
      type: 'String'
    }
  },
  _GlobalConfig: {
    objectId: {
      type: 'String'
    },
    params: {
      type: 'Object'
    }
  },
  _Audience: {
    objectId: {
      type: 'String'
    },
    name: {
      type: 'String'
    },
    query: {
      type: 'String'
    },
    //storing query as JSON string to prevent "Nested keys should not contain the '$' or '.' characters" error
    lastUsed: {
      type: 'Date'
    },
    timesUsed: {
      type: 'Number'
    }
  }
});
exports.defaultColumns = defaultColumns;
const requiredColumns = Object.freeze({
  _Product: ['productIdentifier', 'icon', 'order', 'title', 'subtitle'],
  _Role: ['name', 'ACL']
});
const systemClasses = Object.freeze(['_User', '_Installation', '_Role', '_Session', '_Product', '_PushStatus', '_JobStatus', '_JobSchedule', '_Audience']);
exports.systemClasses = systemClasses;
const volatileClasses = Object.freeze(['_JobStatus', '_PushStatus', '_Hooks', '_GlobalConfig', '_JobSchedule', '_Audience']); // 10 alpha numberic chars + uppercase

const userIdRegex = /^[a-zA-Z0-9]{10}$/; // Anything that start with role

const roleRegex = /^role:.*/; // * permission

const publicRegex = /^\*$/;
const requireAuthenticationRegex = /^requiresAuthentication$/;
const permissionKeyRegex = Object.freeze([userIdRegex, roleRegex, publicRegex, requireAuthenticationRegex]);

function verifyPermissionKey(key) {
  const result = permissionKeyRegex.reduce((isGood, regEx) => {
    isGood = isGood || key.match(regEx) != null;
    return isGood;
  }, false);

  if (!result) {
    throw new Parse.Error(Parse.Error.INVALID_JSON, `'${key}' is not a valid key for class level permissions`);
  }
}

const CLPValidKeys = Object.freeze(['find', 'count', 'get', 'create', 'update', 'delete', 'addField', 'readUserFields', 'writeUserFields', 'protectedFields']);

function validateCLP(perms, fields) {
  if (!perms) {
    return;
  }

  Object.keys(perms).forEach(operation => {
    if (CLPValidKeys.indexOf(operation) == -1) {
      throw new Parse.Error(Parse.Error.INVALID_JSON, `${operation} is not a valid operation for class level permissions`);
    }

    if (!perms[operation]) {
      return;
    }

    if (operation === 'readUserFields' || operation === 'writeUserFields') {
      if (!Array.isArray(perms[operation])) {
        // -disable-next
        throw new Parse.Error(Parse.Error.INVALID_JSON, `'${perms[operation]}' is not a valid value for class level permissions ${operation}`);
      } else {
        perms[operation].forEach(key => {
          if (!fields[key] || fields[key].type != 'Pointer' || fields[key].targetClass != '_User') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `'${key}' is not a valid column for class level pointer permissions ${operation}`);
          }
        });
      }

      return;
    } // -disable-next


    Object.keys(perms[operation]).forEach(key => {
      verifyPermissionKey(key); // -disable-next

      const perm = perms[operation][key];

      if (perm !== true && (operation !== 'protectedFields' || !Array.isArray(perm))) {
        // -disable-next
        throw new Parse.Error(Parse.Error.INVALID_JSON, `'${perm}' is not a valid value for class level permissions ${operation}:${key}:${perm}`);
      }
    });
  });
}

const joinClassRegex = /^_Join:[A-Za-z0-9_]+:[A-Za-z0-9_]+/;
const classAndFieldRegex = /^[A-Za-z][A-Za-z0-9_]*$/;

function classNameIsValid(className) {
  // Valid classes must:
  return (// Be one of _User, _Installation, _Role, _Session OR
    systemClasses.indexOf(className) > -1 || // Be a join table OR
    joinClassRegex.test(className) || // Include only alpha-numeric and underscores, and not start with an underscore or number
    fieldNameIsValid(className)
  );
} // Valid fields must be alpha-numeric, and not start with an underscore or number


function fieldNameIsValid(fieldName) {
  return classAndFieldRegex.test(fieldName);
} // Checks that it's not trying to clobber one of the default fields of the class.


function fieldNameIsValidForClass(fieldName, className) {
  if (!fieldNameIsValid(fieldName)) {
    return false;
  }

  if (defaultColumns._Default[fieldName]) {
    return false;
  }

  if (defaultColumns[className] && defaultColumns[className][fieldName]) {
    return false;
  }

  return true;
}

function invalidClassNameMessage(className) {
  return 'Invalid classname: ' + className + ', classnames can only have alphanumeric characters and _, and must start with an alpha character ';
}

const invalidJsonError = new Parse.Error(Parse.Error.INVALID_JSON, 'invalid JSON');
const validNonRelationOrPointerTypes = ['Number', 'String', 'Boolean', 'Date', 'Object', 'Array', 'GeoPoint', 'File', 'Bytes', 'Polygon']; // Returns an error suitable for throwing if the type is invalid

const fieldTypeIsInvalid = ({
  type,
  targetClass
}) => {
  if (['Pointer', 'Relation'].indexOf(type) >= 0) {
    if (!targetClass) {
      return new Parse.Error(135, `type ${type} needs a class name`);
    } else if (typeof targetClass !== 'string') {
      return invalidJsonError;
    } else if (!classNameIsValid(targetClass)) {
      return new Parse.Error(Parse.Error.INVALID_CLASS_NAME, invalidClassNameMessage(targetClass));
    } else {
      return undefined;
    }
  }

  if (typeof type !== 'string') {
    return invalidJsonError;
  }

  if (validNonRelationOrPointerTypes.indexOf(type) < 0) {
    return new Parse.Error(Parse.Error.INCORRECT_TYPE, `invalid field type: ${type}`);
  }

  return undefined;
};

const convertSchemaToAdapterSchema = schema => {
  schema = injectDefaultSchema(schema);
  delete schema.fields.ACL;
  schema.fields._rperm = {
    type: 'Array'
  };
  schema.fields._wperm = {
    type: 'Array'
  };

  if (schema.className === '_User') {
    delete schema.fields.password;
    schema.fields._hashed_password = {
      type: 'String'
    };
  }

  return schema;
};

exports.convertSchemaToAdapterSchema = convertSchemaToAdapterSchema;

const convertAdapterSchemaToParseSchema = (_ref) => {
  let schema = _extends({}, _ref);

  delete schema.fields._rperm;
  delete schema.fields._wperm;
  schema.fields.ACL = {
    type: 'ACL'
  };

  if (schema.className === '_User') {
    delete schema.fields.authData; //Auth data is implicit

    delete schema.fields._hashed_password;
    schema.fields.password = {
      type: 'String'
    };
  }

  if (schema.indexes && Object.keys(schema.indexes).length === 0) {
    delete schema.indexes;
  }

  return schema;
};

class SchemaData {
  constructor(allSchemas = [], protectedFields = {}) {
    this.__data = {};
    this.__protectedFields = protectedFields;
    allSchemas.forEach(schema => {
      Object.defineProperty(this, schema.className, {
        get: () => {
          if (!this.__data[schema.className]) {
            const data = {};
            data.fields = injectDefaultSchema(schema).fields;
            data.classLevelPermissions = (0, _deepcopy.default)(schema.classLevelPermissions);
            data.indexes = schema.indexes;
            const classProtectedFields = this.__protectedFields[schema.className];

            if (classProtectedFields) {
              for (const key in classProtectedFields) {
                const unq = new Set([...(data.classLevelPermissions.protectedFields[key] || []), ...classProtectedFields[key]]);
                data.classLevelPermissions.protectedFields[key] = Array.from(unq);
              }
            }

            this.__data[schema.className] = data;
          }

          return this.__data[schema.className];
        }
      });
    }); // Inject the in-memory classes

    volatileClasses.forEach(className => {
      Object.defineProperty(this, className, {
        get: () => {
          if (!this.__data[className]) {
            const schema = injectDefaultSchema({
              className,
              fields: {},
              classLevelPermissions: {}
            });
            const data = {};
            data.fields = schema.fields;
            data.classLevelPermissions = schema.classLevelPermissions;
            data.indexes = schema.indexes;
            this.__data[className] = data;
          }

          return this.__data[className];
        }
      });
    });
  }

}

const injectDefaultSchema = ({
  className,
  fields,
  classLevelPermissions,
  indexes
}) => {
  const defaultSchema = {
    className,
    fields: _objectSpread({}, defaultColumns._Default, defaultColumns[className] || {}, fields),
    classLevelPermissions
  };

  if (indexes && Object.keys(indexes).length !== 0) {
    defaultSchema.indexes = indexes;
  }

  return defaultSchema;
};

const _HooksSchema = {
  className: '_Hooks',
  fields: defaultColumns._Hooks
};
const _GlobalConfigSchema = {
  className: '_GlobalConfig',
  fields: defaultColumns._GlobalConfig
};

const _PushStatusSchema = convertSchemaToAdapterSchema(injectDefaultSchema({
  className: '_PushStatus',
  fields: {},
  classLevelPermissions: {}
}));

const _JobStatusSchema = convertSchemaToAdapterSchema(injectDefaultSchema({
  className: '_JobStatus',
  fields: {},
  classLevelPermissions: {}
}));

const _JobScheduleSchema = convertSchemaToAdapterSchema(injectDefaultSchema({
  className: '_JobSchedule',
  fields: {},
  classLevelPermissions: {}
}));

const _AudienceSchema = convertSchemaToAdapterSchema(injectDefaultSchema({
  className: '_Audience',
  fields: defaultColumns._Audience,
  classLevelPermissions: {}
}));

const VolatileClassesSchemas = [_HooksSchema, _JobStatusSchema, _JobScheduleSchema, _PushStatusSchema, _GlobalConfigSchema, _AudienceSchema];
exports.VolatileClassesSchemas = VolatileClassesSchemas;

const dbTypeMatchesObjectType = (dbType, objectType) => {
  if (dbType.type !== objectType.type) return false;
  if (dbType.targetClass !== objectType.targetClass) return false;
  if (dbType === objectType.type) return true;
  if (dbType.type === objectType.type) return true;
  return false;
};

const typeToString = type => {
  if (typeof type === 'string') {
    return type;
  }

  if (type.targetClass) {
    return `${type.type}<${type.targetClass}>`;
  }

  return `${type.type}`;
}; // Stores the entire schema of the app in a weird hybrid format somewhere between
// the mongo format and the Parse format. Soon, this will all be Parse format.


class SchemaController {
  constructor(databaseAdapter, schemaCache) {
    this._dbAdapter = databaseAdapter;
    this._cache = schemaCache;
    this.schemaData = new SchemaData();
    this.protectedFields = _Config.default.get(Parse.applicationId).protectedFields;
  }

  reloadData(options = {
    clearCache: false
  }) {
    let promise = Promise.resolve();

    if (options.clearCache) {
      promise = promise.then(() => {
        return this._cache.clear();
      });
    }

    if (this.reloadDataPromise && !options.clearCache) {
      return this.reloadDataPromise;
    }

    this.reloadDataPromise = promise.then(() => {
      return this.getAllClasses(options).then(allSchemas => {
        this.schemaData = new SchemaData(allSchemas, this.protectedFields);
        delete this.reloadDataPromise;
      }, err => {
        this.schemaData = new SchemaData();
        delete this.reloadDataPromise;
        throw err;
      });
    }).then(() => {});
    return this.reloadDataPromise;
  }

  getAllClasses(options = {
    clearCache: false
  }) {
    let promise = Promise.resolve();

    if (options.clearCache) {
      promise = this._cache.clear();
    }

    return promise.then(() => {
      return this._cache.getAllClasses();
    }).then(allClasses => {
      if (allClasses && allClasses.length && !options.clearCache) {
        return Promise.resolve(allClasses);
      }

      return this._dbAdapter.getAllClasses().then(allSchemas => allSchemas.map(injectDefaultSchema)).then(allSchemas => {
        return this._cache.setAllClasses(allSchemas).then(() => {
          return allSchemas;
        });
      });
    });
  }

  getOneSchema(className, allowVolatileClasses = false, options = {
    clearCache: false
  }) {
    let promise = Promise.resolve();

    if (options.clearCache) {
      promise = this._cache.clear();
    }

    return promise.then(() => {
      if (allowVolatileClasses && volatileClasses.indexOf(className) > -1) {
        const data = this.schemaData[className];
        return Promise.resolve({
          className,
          fields: data.fields,
          classLevelPermissions: data.classLevelPermissions,
          indexes: data.indexes
        });
      }

      return this._cache.getOneSchema(className).then(cached => {
        if (cached && !options.clearCache) {
          return Promise.resolve(cached);
        }

        return this._dbAdapter.getClass(className).then(injectDefaultSchema).then(result => {
          return this._cache.setOneSchema(className, result).then(() => {
            return result;
          });
        });
      });
    });
  } // Create a new class that includes the three default fields.
  // ACL is an implicit column that does not get an entry in the
  // _SCHEMAS database. Returns a promise that resolves with the
  // created schema, in mongo format.
  // on success, and rejects with an error on fail. Ensure you
  // have authorization (master key, or client class creation
  // enabled) before calling this function.


  addClassIfNotExists(className, fields = {}, classLevelPermissions, indexes = {}) {
    var validationError = this.validateNewClass(className, fields, classLevelPermissions);

    if (validationError) {
      return Promise.reject(validationError);
    }

    return this._dbAdapter.createClass(className, convertSchemaToAdapterSchema({
      fields,
      classLevelPermissions,
      indexes,
      className
    })).then(convertAdapterSchemaToParseSchema).then(res => {
      return this._cache.clear().then(() => {
        return Promise.resolve(res);
      });
    }).catch(error => {
      if (error && error.code === Parse.Error.DUPLICATE_VALUE) {
        throw new Parse.Error(Parse.Error.INVALID_CLASS_NAME, `Class ${className} already exists.`);
      } else {
        throw error;
      }
    });
  }

  updateClass(className, submittedFields, classLevelPermissions, indexes, database) {
    return this.getOneSchema(className).then(schema => {
      const existingFields = schema.fields;
      Object.keys(submittedFields).forEach(name => {
        const field = submittedFields[name];

        if (existingFields[name] && field.__op !== 'Delete') {
          throw new Parse.Error(255, `Field ${name} exists, cannot update.`);
        }

        if (!existingFields[name] && field.__op === 'Delete') {
          throw new Parse.Error(255, `Field ${name} does not exist, cannot delete.`);
        }
      });
      delete existingFields._rperm;
      delete existingFields._wperm;
      const newSchema = buildMergedSchemaObject(existingFields, submittedFields);
      const defaultFields = defaultColumns[className] || defaultColumns._Default;
      const fullNewSchema = Object.assign({}, newSchema, defaultFields);
      const validationError = this.validateSchemaData(className, newSchema, classLevelPermissions, Object.keys(existingFields));

      if (validationError) {
        throw new Parse.Error(validationError.code, validationError.error);
      } // Finally we have checked to make sure the request is valid and we can start deleting fields.
      // Do all deletions first, then a single save to _SCHEMA collection to handle all additions.


      const deletedFields = [];
      const insertedFields = [];
      Object.keys(submittedFields).forEach(fieldName => {
        if (submittedFields[fieldName].__op === 'Delete') {
          deletedFields.push(fieldName);
        } else {
          insertedFields.push(fieldName);
        }
      });
      let deletePromise = Promise.resolve();

      if (deletedFields.length > 0) {
        deletePromise = this.deleteFields(deletedFields, className, database);
      }

      return deletePromise // Delete Everything
      .then(() => this.reloadData({
        clearCache: true
      })) // Reload our Schema, so we have all the new values
      .then(() => {
        const promises = insertedFields.map(fieldName => {
          const type = submittedFields[fieldName];
          return this.enforceFieldExists(className, fieldName, type);
        });
        return Promise.all(promises);
      }).then(() => this.setPermissions(className, classLevelPermissions, newSchema)).then(() => this._dbAdapter.setIndexesWithSchemaFormat(className, indexes, schema.indexes, fullNewSchema)).then(() => this.reloadData({
        clearCache: true
      })) //TODO: Move this logic into the database adapter
      .then(() => {
        const schema = this.schemaData[className];
        const reloadedSchema = {
          className: className,
          fields: schema.fields,
          classLevelPermissions: schema.classLevelPermissions
        };

        if (schema.indexes && Object.keys(schema.indexes).length !== 0) {
          reloadedSchema.indexes = schema.indexes;
        }

        return reloadedSchema;
      });
    }).catch(error => {
      if (error === undefined) {
        throw new Parse.Error(Parse.Error.INVALID_CLASS_NAME, `Class ${className} does not exist.`);
      } else {
        throw error;
      }
    });
  } // Returns a promise that resolves successfully to the new schema
  // object or fails with a reason.


  enforceClassExists(className) {
    if (this.schemaData[className]) {
      return Promise.resolve(this);
    } // We don't have this class. Update the schema


    return this.addClassIfNotExists(className) // The schema update succeeded. Reload the schema
    .then(() => this.reloadData({
      clearCache: true
    })).catch(() => {
      // The schema update failed. This can be okay - it might
      // have failed because there's a race condition and a different
      // client is making the exact same schema update that we want.
      // So just reload the schema.
      return this.reloadData({
        clearCache: true
      });
    }).then(() => {
      // Ensure that the schema now validates
      if (this.schemaData[className]) {
        return this;
      } else {
        throw new Parse.Error(Parse.Error.INVALID_JSON, `Failed to add ${className}`);
      }
    }).catch(() => {
      // The schema still doesn't validate. Give up
      throw new Parse.Error(Parse.Error.INVALID_JSON, 'schema class name does not revalidate');
    });
  }

  validateNewClass(className, fields = {}, classLevelPermissions) {
    if (this.schemaData[className]) {
      throw new Parse.Error(Parse.Error.INVALID_CLASS_NAME, `Class ${className} already exists.`);
    }

    if (!classNameIsValid(className)) {
      return {
        code: Parse.Error.INVALID_CLASS_NAME,
        error: invalidClassNameMessage(className)
      };
    }

    return this.validateSchemaData(className, fields, classLevelPermissions, []);
  }

  validateSchemaData(className, fields, classLevelPermissions, existingFieldNames) {
    for (const fieldName in fields) {
      if (existingFieldNames.indexOf(fieldName) < 0) {
        if (!fieldNameIsValid(fieldName)) {
          return {
            code: Parse.Error.INVALID_KEY_NAME,
            error: 'invalid field name: ' + fieldName
          };
        }

        if (!fieldNameIsValidForClass(fieldName, className)) {
          return {
            code: 136,
            error: 'field ' + fieldName + ' cannot be added'
          };
        }

        const error = fieldTypeIsInvalid(fields[fieldName]);
        if (error) return {
          code: error.code,
          error: error.message
        };
      }
    }

    for (const fieldName in defaultColumns[className]) {
      fields[fieldName] = defaultColumns[className][fieldName];
    }

    const geoPoints = Object.keys(fields).filter(key => fields[key] && fields[key].type === 'GeoPoint');

    if (geoPoints.length > 1) {
      return {
        code: Parse.Error.INCORRECT_TYPE,
        error: 'currently, only one GeoPoint field may exist in an object. Adding ' + geoPoints[1] + ' when ' + geoPoints[0] + ' already exists.'
      };
    }

    validateCLP(classLevelPermissions, fields);
  } // Sets the Class-level permissions for a given className, which must exist.


  setPermissions(className, perms, newSchema) {
    if (typeof perms === 'undefined') {
      return Promise.resolve();
    }

    validateCLP(perms, newSchema);
    return this._dbAdapter.setClassLevelPermissions(className, perms);
  } // Returns a promise that resolves successfully to the new schema
  // object if the provided className-fieldName-type tuple is valid.
  // The className must already be validated.
  // If 'freeze' is true, refuse to update the schema for this field.


  enforceFieldExists(className, fieldName, type) {
    if (fieldName.indexOf('.') > 0) {
      // subdocument key (x.y) => ok if x is of type 'object'
      fieldName = fieldName.split('.')[0];
      type = 'Object';
    }

    if (!fieldNameIsValid(fieldName)) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, `Invalid field name: ${fieldName}.`);
    } // If someone tries to create a new field with null/undefined as the value, return;


    if (!type) {
      return Promise.resolve(this);
    }

    return this.reloadData().then(() => {
      const expectedType = this.getExpectedType(className, fieldName);

      if (typeof type === 'string') {
        type = {
          type
        };
      }

      if (expectedType) {
        if (!dbTypeMatchesObjectType(expectedType, type)) {
          throw new Parse.Error(Parse.Error.INCORRECT_TYPE, `schema mismatch for ${className}.${fieldName}; expected ${typeToString(expectedType)} but got ${typeToString(type)}`);
        }

        return this;
      }

      return this._dbAdapter.addFieldIfNotExists(className, fieldName, type).then(() => {
        // The update succeeded. Reload the schema
        return this.reloadData({
          clearCache: true
        });
      }, error => {
        if (error.code == Parse.Error.INCORRECT_TYPE) {
          // Make sure that we throw errors when it is appropriate to do so.
          throw error;
        } // The update failed. This can be okay - it might have been a race
        // condition where another client updated the schema in the same
        // way that we wanted to. So, just reload the schema


        return this.reloadData({
          clearCache: true
        });
      }).then(() => {
        // Ensure that the schema now validates
        const expectedType = this.getExpectedType(className, fieldName);

        if (typeof type === 'string') {
          type = {
            type
          };
        }

        if (!expectedType || !dbTypeMatchesObjectType(expectedType, type)) {
          throw new Parse.Error(Parse.Error.INVALID_JSON, `Could not add field ${fieldName}`);
        } // Remove the cached schema


        this._cache.clear();

        return this;
      });
    });
  } // maintain compatibility


  deleteField(fieldName, className, database) {
    return this.deleteFields([fieldName], className, database);
  } // Delete fields, and remove that data from all objects. This is intended
  // to remove unused fields, if other writers are writing objects that include
  // this field, the field may reappear. Returns a Promise that resolves with
  // no object on success, or rejects with { code, error } on failure.
  // Passing the database and prefix is necessary in order to drop relation collections
  // and remove fields from objects. Ideally the database would belong to
  // a database adapter and this function would close over it or access it via member.


  deleteFields(fieldNames, className, database) {
    if (!classNameIsValid(className)) {
      throw new Parse.Error(Parse.Error.INVALID_CLASS_NAME, invalidClassNameMessage(className));
    }

    fieldNames.forEach(fieldName => {
      if (!fieldNameIsValid(fieldName)) {
        throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, `invalid field name: ${fieldName}`);
      } //Don't allow deleting the default fields.


      if (!fieldNameIsValidForClass(fieldName, className)) {
        throw new Parse.Error(136, `field ${fieldName} cannot be changed`);
      }
    });
    return this.getOneSchema(className, false, {
      clearCache: true
    }).catch(error => {
      if (error === undefined) {
        throw new Parse.Error(Parse.Error.INVALID_CLASS_NAME, `Class ${className} does not exist.`);
      } else {
        throw error;
      }
    }).then(schema => {
      fieldNames.forEach(fieldName => {
        if (!schema.fields[fieldName]) {
          throw new Parse.Error(255, `Field ${fieldName} does not exist, cannot delete.`);
        }
      });

      const schemaFields = _objectSpread({}, schema.fields);

      return database.adapter.deleteFields(className, schema, fieldNames).then(() => {
        return Promise.all(fieldNames.map(fieldName => {
          const field = schemaFields[fieldName];

          if (field && field.type === 'Relation') {
            //For relations, drop the _Join table
            return database.adapter.deleteClass(`_Join:${fieldName}:${className}`);
          }

          return Promise.resolve();
        }));
      });
    }).then(() => {
      this._cache.clear();
    });
  } // Validates an object provided in REST format.
  // Returns a promise that resolves to the new schema if this object is
  // valid.


  validateObject(className, object, query) {
    let geocount = 0;
    let promise = this.enforceClassExists(className);

    for (const fieldName in object) {
      if (object[fieldName] === undefined) {
        continue;
      }

      const expected = getType(object[fieldName]);

      if (expected === 'GeoPoint') {
        geocount++;
      }

      if (geocount > 1) {
        // Make sure all field validation operations run before we return.
        // If not - we are continuing to run logic, but already provided response from the server.
        return promise.then(() => {
          return Promise.reject(new Parse.Error(Parse.Error.INCORRECT_TYPE, 'there can only be one geopoint field in a class'));
        });
      }

      if (!expected) {
        continue;
      }

      if (fieldName === 'ACL') {
        // Every object has ACL implicitly.
        continue;
      }

      promise = promise.then(schema => schema.enforceFieldExists(className, fieldName, expected));
    }

    promise = thenValidateRequiredColumns(promise, className, object, query);
    return promise;
  } // Validates that all the properties are set for the object


  validateRequiredColumns(className, object, query) {
    const columns = requiredColumns[className];

    if (!columns || columns.length == 0) {
      return Promise.resolve(this);
    }

    const missingColumns = columns.filter(function (column) {
      if (query && query.objectId) {
        if (object[column] && typeof object[column] === 'object') {
          // Trying to delete a required column
          return object[column].__op == 'Delete';
        } // Not trying to do anything there


        return false;
      }

      return !object[column];
    });

    if (missingColumns.length > 0) {
      throw new Parse.Error(Parse.Error.INCORRECT_TYPE, missingColumns[0] + ' is required.');
    }

    return Promise.resolve(this);
  }

  testPermissionsForClassName(className, aclGroup, operation) {
    return SchemaController.testPermissions(this.getClassLevelPermissions(className), aclGroup, operation);
  } // Tests that the class level permission let pass the operation for a given aclGroup


  static testPermissions(classPermissions, aclGroup, operation) {
    if (!classPermissions || !classPermissions[operation]) {
      return true;
    }

    const perms = classPermissions[operation];

    if (perms['*']) {
      return true;
    } // Check permissions against the aclGroup provided (array of userId/roles)


    if (aclGroup.some(acl => {
      return perms[acl] === true;
    })) {
      return true;
    }

    return false;
  } // Validates an operation passes class-level-permissions set in the schema


  static validatePermission(classPermissions, className, aclGroup, operation) {
    if (SchemaController.testPermissions(classPermissions, aclGroup, operation)) {
      return Promise.resolve();
    }

    if (!classPermissions || !classPermissions[operation]) {
      return true;
    }

    const perms = classPermissions[operation]; // If only for authenticated users
    // make sure we have an aclGroup

    if (perms['requiresAuthentication']) {
      // If aclGroup has * (public)
      if (!aclGroup || aclGroup.length == 0) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Permission denied, user needs to be authenticated.');
      } else if (aclGroup.indexOf('*') > -1 && aclGroup.length == 1) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Permission denied, user needs to be authenticated.');
      } // requiresAuthentication passed, just move forward
      // probably would be wise at some point to rename to 'authenticatedUser'


      return Promise.resolve();
    } // No matching CLP, let's check the Pointer permissions
    // And handle those later


    const permissionField = ['get', 'find', 'count'].indexOf(operation) > -1 ? 'readUserFields' : 'writeUserFields'; // Reject create when write lockdown

    if (permissionField == 'writeUserFields' && operation == 'create') {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, `Permission denied for action ${operation} on class ${className}.`);
    } // Process the readUserFields later


    if (Array.isArray(classPermissions[permissionField]) && classPermissions[permissionField].length > 0) {
      return Promise.resolve();
    }

    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, `Permission denied for action ${operation} on class ${className}.`);
  } // Validates an operation passes class-level-permissions set in the schema


  validatePermission(className, aclGroup, operation) {
    return SchemaController.validatePermission(this.getClassLevelPermissions(className), className, aclGroup, operation);
  }

  getClassLevelPermissions(className) {
    return this.schemaData[className] && this.schemaData[className].classLevelPermissions;
  } // Returns the expected type for a className+key combination
  // or undefined if the schema is not set


  getExpectedType(className, fieldName) {
    if (this.schemaData[className]) {
      const expectedType = this.schemaData[className].fields[fieldName];
      return expectedType === 'map' ? 'Object' : expectedType;
    }

    return undefined;
  } // Checks if a given class is in the schema.


  hasClass(className) {
    return this.reloadData().then(() => !!this.schemaData[className]);
  }

} // Returns a promise for a new Schema.


exports.SchemaController = exports.default = SchemaController;

const load = (dbAdapter, schemaCache, options) => {
  const schema = new SchemaController(dbAdapter, schemaCache);
  return schema.reloadData(options).then(() => schema);
}; // Builds a new schema (in schema API response format) out of an
// existing mongo schema + a schemas API put request. This response
// does not include the default fields, as it is intended to be passed
// to mongoSchemaFromFieldsAndClassName. No validation is done here, it
// is done in mongoSchemaFromFieldsAndClassName.


exports.load = load;

function buildMergedSchemaObject(existingFields, putRequest) {
  const newSchema = {}; // -disable-next

  const sysSchemaField = Object.keys(defaultColumns).indexOf(existingFields._id) === -1 ? [] : Object.keys(defaultColumns[existingFields._id]);

  for (const oldField in existingFields) {
    if (oldField !== '_id' && oldField !== 'ACL' && oldField !== 'updatedAt' && oldField !== 'createdAt' && oldField !== 'objectId') {
      if (sysSchemaField.length > 0 && sysSchemaField.indexOf(oldField) !== -1) {
        continue;
      }

      const fieldIsDeleted = putRequest[oldField] && putRequest[oldField].__op === 'Delete';

      if (!fieldIsDeleted) {
        newSchema[oldField] = existingFields[oldField];
      }
    }
  }

  for (const newField in putRequest) {
    if (newField !== 'objectId' && putRequest[newField].__op !== 'Delete') {
      if (sysSchemaField.length > 0 && sysSchemaField.indexOf(newField) !== -1) {
        continue;
      }

      newSchema[newField] = putRequest[newField];
    }
  }

  return newSchema;
} // Given a schema promise, construct another schema promise that
// validates this field once the schema loads.


function thenValidateRequiredColumns(schemaPromise, className, object, query) {
  return schemaPromise.then(schema => {
    return schema.validateRequiredColumns(className, object, query);
  });
} // Gets the type from a REST API formatted object, where 'type' is
// extended past javascript types to include the rest of the Parse
// type system.
// The output should be a valid schema value.
// TODO: ensure that this is compatible with the format used in Open DB


function getType(obj) {
  const type = typeof obj;

  switch (type) {
    case 'boolean':
      return 'Boolean';

    case 'string':
      return 'String';

    case 'number':
      return 'Number';

    case 'map':
    case 'object':
      if (!obj) {
        return undefined;
      }

      return getObjectType(obj);

    case 'function':
    case 'symbol':
    case 'undefined':
    default:
      throw 'bad obj: ' + obj;
  }
} // This gets the type for non-JSON types like pointers and files, but
// also gets the appropriate type for $ operators.
// Returns null if the type is unknown.


function getObjectType(obj) {
  if (obj instanceof Array) {
    return 'Array';
  }

  if (obj.__type) {
    switch (obj.__type) {
      case 'Pointer':
        if (obj.className) {
          return {
            type: 'Pointer',
            targetClass: obj.className
          };
        }

        break;

      case 'Relation':
        if (obj.className) {
          return {
            type: 'Relation',
            targetClass: obj.className
          };
        }

        break;

      case 'File':
        if (obj.name) {
          return 'File';
        }

        break;

      case 'Date':
        if (obj.iso) {
          return 'Date';
        }

        break;

      case 'GeoPoint':
        if (obj.latitude != null && obj.longitude != null) {
          return 'GeoPoint';
        }

        break;

      case 'Bytes':
        if (obj.base64) {
          return 'Bytes';
        }

        break;

      case 'Polygon':
        if (obj.coordinates) {
          return 'Polygon';
        }

        break;
    }

    throw new Parse.Error(Parse.Error.INCORRECT_TYPE, 'This is not a valid ' + obj.__type);
  }

  if (obj['$ne']) {
    return getObjectType(obj['$ne']);
  }

  if (obj.__op) {
    switch (obj.__op) {
      case 'Increment':
        return 'Number';

      case 'Delete':
        return null;

      case 'Add':
      case 'AddUnique':
      case 'Remove':
        return 'Array';

      case 'AddRelation':
      case 'RemoveRelation':
        return {
          type: 'Relation',
          targetClass: obj.objects[0].className
        };

      case 'Batch':
        return getObjectType(obj.ops[0]);

      default:
        throw 'unexpected op: ' + obj.__op;
    }
  }

  return 'Object';
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9TY2hlbWFDb250cm9sbGVyLmpzIl0sIm5hbWVzIjpbIlBhcnNlIiwicmVxdWlyZSIsImRlZmF1bHRDb2x1bW5zIiwiT2JqZWN0IiwiZnJlZXplIiwiX0RlZmF1bHQiLCJvYmplY3RJZCIsInR5cGUiLCJjcmVhdGVkQXQiLCJ1cGRhdGVkQXQiLCJBQ0wiLCJfVXNlciIsInVzZXJuYW1lIiwicGFzc3dvcmQiLCJlbWFpbCIsImVtYWlsVmVyaWZpZWQiLCJhdXRoRGF0YSIsIl9JbnN0YWxsYXRpb24iLCJpbnN0YWxsYXRpb25JZCIsImRldmljZVRva2VuIiwiY2hhbm5lbHMiLCJkZXZpY2VUeXBlIiwicHVzaFR5cGUiLCJHQ01TZW5kZXJJZCIsInRpbWVab25lIiwibG9jYWxlSWRlbnRpZmllciIsImJhZGdlIiwiYXBwVmVyc2lvbiIsImFwcE5hbWUiLCJhcHBJZGVudGlmaWVyIiwicGFyc2VWZXJzaW9uIiwiX1JvbGUiLCJuYW1lIiwidXNlcnMiLCJ0YXJnZXRDbGFzcyIsInJvbGVzIiwiX1Nlc3Npb24iLCJyZXN0cmljdGVkIiwidXNlciIsInNlc3Npb25Ub2tlbiIsImV4cGlyZXNBdCIsImNyZWF0ZWRXaXRoIiwiX1Byb2R1Y3QiLCJwcm9kdWN0SWRlbnRpZmllciIsImRvd25sb2FkIiwiZG93bmxvYWROYW1lIiwiaWNvbiIsIm9yZGVyIiwidGl0bGUiLCJzdWJ0aXRsZSIsIl9QdXNoU3RhdHVzIiwicHVzaFRpbWUiLCJzb3VyY2UiLCJxdWVyeSIsInBheWxvYWQiLCJleHBpcnkiLCJleHBpcmF0aW9uX2ludGVydmFsIiwic3RhdHVzIiwibnVtU2VudCIsIm51bUZhaWxlZCIsInB1c2hIYXNoIiwiZXJyb3JNZXNzYWdlIiwic2VudFBlclR5cGUiLCJmYWlsZWRQZXJUeXBlIiwic2VudFBlclVUQ09mZnNldCIsImZhaWxlZFBlclVUQ09mZnNldCIsImNvdW50IiwiX0pvYlN0YXR1cyIsImpvYk5hbWUiLCJtZXNzYWdlIiwicGFyYW1zIiwiZmluaXNoZWRBdCIsIl9Kb2JTY2hlZHVsZSIsImRlc2NyaXB0aW9uIiwic3RhcnRBZnRlciIsImRheXNPZldlZWsiLCJ0aW1lT2ZEYXkiLCJsYXN0UnVuIiwicmVwZWF0TWludXRlcyIsIl9Ib29rcyIsImZ1bmN0aW9uTmFtZSIsImNsYXNzTmFtZSIsInRyaWdnZXJOYW1lIiwidXJsIiwiX0dsb2JhbENvbmZpZyIsIl9BdWRpZW5jZSIsImxhc3RVc2VkIiwidGltZXNVc2VkIiwicmVxdWlyZWRDb2x1bW5zIiwic3lzdGVtQ2xhc3NlcyIsInZvbGF0aWxlQ2xhc3NlcyIsInVzZXJJZFJlZ2V4Iiwicm9sZVJlZ2V4IiwicHVibGljUmVnZXgiLCJyZXF1aXJlQXV0aGVudGljYXRpb25SZWdleCIsInBlcm1pc3Npb25LZXlSZWdleCIsInZlcmlmeVBlcm1pc3Npb25LZXkiLCJrZXkiLCJyZXN1bHQiLCJyZWR1Y2UiLCJpc0dvb2QiLCJyZWdFeCIsIm1hdGNoIiwiRXJyb3IiLCJJTlZBTElEX0pTT04iLCJDTFBWYWxpZEtleXMiLCJ2YWxpZGF0ZUNMUCIsInBlcm1zIiwiZmllbGRzIiwia2V5cyIsImZvckVhY2giLCJvcGVyYXRpb24iLCJpbmRleE9mIiwiQXJyYXkiLCJpc0FycmF5IiwicGVybSIsImpvaW5DbGFzc1JlZ2V4IiwiY2xhc3NBbmRGaWVsZFJlZ2V4IiwiY2xhc3NOYW1lSXNWYWxpZCIsInRlc3QiLCJmaWVsZE5hbWVJc1ZhbGlkIiwiZmllbGROYW1lIiwiZmllbGROYW1lSXNWYWxpZEZvckNsYXNzIiwiaW52YWxpZENsYXNzTmFtZU1lc3NhZ2UiLCJpbnZhbGlkSnNvbkVycm9yIiwidmFsaWROb25SZWxhdGlvbk9yUG9pbnRlclR5cGVzIiwiZmllbGRUeXBlSXNJbnZhbGlkIiwiSU5WQUxJRF9DTEFTU19OQU1FIiwidW5kZWZpbmVkIiwiSU5DT1JSRUNUX1RZUEUiLCJjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hIiwic2NoZW1hIiwiaW5qZWN0RGVmYXVsdFNjaGVtYSIsIl9ycGVybSIsIl93cGVybSIsIl9oYXNoZWRfcGFzc3dvcmQiLCJjb252ZXJ0QWRhcHRlclNjaGVtYVRvUGFyc2VTY2hlbWEiLCJpbmRleGVzIiwibGVuZ3RoIiwiU2NoZW1hRGF0YSIsImNvbnN0cnVjdG9yIiwiYWxsU2NoZW1hcyIsInByb3RlY3RlZEZpZWxkcyIsIl9fZGF0YSIsIl9fcHJvdGVjdGVkRmllbGRzIiwiZGVmaW5lUHJvcGVydHkiLCJnZXQiLCJkYXRhIiwiY2xhc3NMZXZlbFBlcm1pc3Npb25zIiwiY2xhc3NQcm90ZWN0ZWRGaWVsZHMiLCJ1bnEiLCJTZXQiLCJmcm9tIiwiZGVmYXVsdFNjaGVtYSIsIl9Ib29rc1NjaGVtYSIsIl9HbG9iYWxDb25maWdTY2hlbWEiLCJfUHVzaFN0YXR1c1NjaGVtYSIsIl9Kb2JTdGF0dXNTY2hlbWEiLCJfSm9iU2NoZWR1bGVTY2hlbWEiLCJfQXVkaWVuY2VTY2hlbWEiLCJWb2xhdGlsZUNsYXNzZXNTY2hlbWFzIiwiZGJUeXBlTWF0Y2hlc09iamVjdFR5cGUiLCJkYlR5cGUiLCJvYmplY3RUeXBlIiwidHlwZVRvU3RyaW5nIiwiU2NoZW1hQ29udHJvbGxlciIsImRhdGFiYXNlQWRhcHRlciIsInNjaGVtYUNhY2hlIiwiX2RiQWRhcHRlciIsIl9jYWNoZSIsInNjaGVtYURhdGEiLCJDb25maWciLCJhcHBsaWNhdGlvbklkIiwicmVsb2FkRGF0YSIsIm9wdGlvbnMiLCJjbGVhckNhY2hlIiwicHJvbWlzZSIsIlByb21pc2UiLCJyZXNvbHZlIiwidGhlbiIsImNsZWFyIiwicmVsb2FkRGF0YVByb21pc2UiLCJnZXRBbGxDbGFzc2VzIiwiZXJyIiwiYWxsQ2xhc3NlcyIsIm1hcCIsInNldEFsbENsYXNzZXMiLCJnZXRPbmVTY2hlbWEiLCJhbGxvd1ZvbGF0aWxlQ2xhc3NlcyIsImNhY2hlZCIsImdldENsYXNzIiwic2V0T25lU2NoZW1hIiwiYWRkQ2xhc3NJZk5vdEV4aXN0cyIsInZhbGlkYXRpb25FcnJvciIsInZhbGlkYXRlTmV3Q2xhc3MiLCJyZWplY3QiLCJjcmVhdGVDbGFzcyIsInJlcyIsImNhdGNoIiwiZXJyb3IiLCJjb2RlIiwiRFVQTElDQVRFX1ZBTFVFIiwidXBkYXRlQ2xhc3MiLCJzdWJtaXR0ZWRGaWVsZHMiLCJkYXRhYmFzZSIsImV4aXN0aW5nRmllbGRzIiwiZmllbGQiLCJfX29wIiwibmV3U2NoZW1hIiwiYnVpbGRNZXJnZWRTY2hlbWFPYmplY3QiLCJkZWZhdWx0RmllbGRzIiwiZnVsbE5ld1NjaGVtYSIsImFzc2lnbiIsInZhbGlkYXRlU2NoZW1hRGF0YSIsImRlbGV0ZWRGaWVsZHMiLCJpbnNlcnRlZEZpZWxkcyIsInB1c2giLCJkZWxldGVQcm9taXNlIiwiZGVsZXRlRmllbGRzIiwicHJvbWlzZXMiLCJlbmZvcmNlRmllbGRFeGlzdHMiLCJhbGwiLCJzZXRQZXJtaXNzaW9ucyIsInNldEluZGV4ZXNXaXRoU2NoZW1hRm9ybWF0IiwicmVsb2FkZWRTY2hlbWEiLCJlbmZvcmNlQ2xhc3NFeGlzdHMiLCJleGlzdGluZ0ZpZWxkTmFtZXMiLCJJTlZBTElEX0tFWV9OQU1FIiwiZ2VvUG9pbnRzIiwiZmlsdGVyIiwic2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zIiwic3BsaXQiLCJleHBlY3RlZFR5cGUiLCJnZXRFeHBlY3RlZFR5cGUiLCJhZGRGaWVsZElmTm90RXhpc3RzIiwiZGVsZXRlRmllbGQiLCJmaWVsZE5hbWVzIiwic2NoZW1hRmllbGRzIiwiYWRhcHRlciIsImRlbGV0ZUNsYXNzIiwidmFsaWRhdGVPYmplY3QiLCJvYmplY3QiLCJnZW9jb3VudCIsImV4cGVjdGVkIiwiZ2V0VHlwZSIsInRoZW5WYWxpZGF0ZVJlcXVpcmVkQ29sdW1ucyIsInZhbGlkYXRlUmVxdWlyZWRDb2x1bW5zIiwiY29sdW1ucyIsIm1pc3NpbmdDb2x1bW5zIiwiY29sdW1uIiwidGVzdFBlcm1pc3Npb25zRm9yQ2xhc3NOYW1lIiwiYWNsR3JvdXAiLCJ0ZXN0UGVybWlzc2lvbnMiLCJnZXRDbGFzc0xldmVsUGVybWlzc2lvbnMiLCJjbGFzc1Blcm1pc3Npb25zIiwic29tZSIsImFjbCIsInZhbGlkYXRlUGVybWlzc2lvbiIsIk9CSkVDVF9OT1RfRk9VTkQiLCJwZXJtaXNzaW9uRmllbGQiLCJPUEVSQVRJT05fRk9SQklEREVOIiwiaGFzQ2xhc3MiLCJsb2FkIiwiZGJBZGFwdGVyIiwicHV0UmVxdWVzdCIsInN5c1NjaGVtYUZpZWxkIiwiX2lkIiwib2xkRmllbGQiLCJmaWVsZElzRGVsZXRlZCIsIm5ld0ZpZWxkIiwic2NoZW1hUHJvbWlzZSIsIm9iaiIsImdldE9iamVjdFR5cGUiLCJfX3R5cGUiLCJpc28iLCJsYXRpdHVkZSIsImxvbmdpdHVkZSIsImJhc2U2NCIsImNvb3JkaW5hdGVzIiwib2JqZWN0cyIsIm9wcyJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7QUFrQkE7O0FBQ0E7O0FBQ0E7O0FBRUE7Ozs7Ozs7Ozs7QUFyQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxNQUFNQSxLQUFLLEdBQUdDLE9BQU8sQ0FBQyxZQUFELENBQVAsQ0FBc0JELEtBQXBDOztBQWNBLE1BQU1FLGNBQTBDLEdBQUdDLE1BQU0sQ0FBQ0MsTUFBUCxDQUFjO0FBQy9EO0FBQ0FDLEVBQUFBLFFBQVEsRUFBRTtBQUNSQyxJQUFBQSxRQUFRLEVBQUU7QUFBRUMsTUFBQUEsSUFBSSxFQUFFO0FBQVIsS0FERjtBQUVSQyxJQUFBQSxTQUFTLEVBQUU7QUFBRUQsTUFBQUEsSUFBSSxFQUFFO0FBQVIsS0FGSDtBQUdSRSxJQUFBQSxTQUFTLEVBQUU7QUFBRUYsTUFBQUEsSUFBSSxFQUFFO0FBQVIsS0FISDtBQUlSRyxJQUFBQSxHQUFHLEVBQUU7QUFBRUgsTUFBQUEsSUFBSSxFQUFFO0FBQVI7QUFKRyxHQUZxRDtBQVEvRDtBQUNBSSxFQUFBQSxLQUFLLEVBQUU7QUFDTEMsSUFBQUEsUUFBUSxFQUFFO0FBQUVMLE1BQUFBLElBQUksRUFBRTtBQUFSLEtBREw7QUFFTE0sSUFB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QUFJRDs7QUFDRCxNQUFJRixHQUFHLENBQUMsS0FBRCxDQUFQLEVBQWdCO0FBQ2QsV0FBT0MsYUFBYSxDQUFDRCxHQUFHLENBQUMsS0FBRCxDQUFKLENBQXBCO0FBQ0Q7O0FBQ0QsTUFBSUEsR0FBRyxDQUFDaEUsSUFBUixFQUFjO0FBQ1osWUFBUWdFLEdBQUcsQ0FBQ2hFLElBQVo7QUFDRSxXQUFLLFdBQUw7QUFDRSxlQUFPLFFBQVA7O0FBQ0YsV0FBSyxRQUFMO0FBQ0UsZUFBTyxJQUFQOztBQUNGLFdBQUssS0FBTDtBQUNBLFdBQUssV0FBTDtBQUNBLFdBQUssUUFBTDtBQUNFLGVBQU8sT0FBUDs7QUFDRixXQUFLLGFBQUw7QUFDQSxXQUFLLGdCQUFMO0FBQ0UsZUFBTztBQUNMeE0sVUFBQUEsSUFBSSxFQUFFLFVBREQ7QUFFTDJCLFVBQUFBLFdBQVcsRUFBRTZPLEdBQUcsQ0FBQ1EsT0FBSixDQUFZLENBQVosRUFBZXRNO0FBRnZCLFNBQVA7O0FBSUYsV0FBSyxPQUFMO0FBQ0UsZUFBTytMLGFBQWEsQ0FBQ0QsR0FBRyxDQUFDUyxHQUFKLENBQVEsQ0FBUixDQUFELENBQXBCOztBQUNGO0FBQ0UsY0FBTSxvQkFBb0JULEdBQUcsQ0FBQ2hFLElBQTlCO0FBbEJKO0FBb0JEOztBQUNELFNBQU8sUUFBUDtBQUNEIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQGZsb3dcbi8vIFRoaXMgY2xhc3MgaGFuZGxlcyBzY2hlbWEgdmFsaWRhdGlvbiwgcGVyc2lzdGVuY2UsIGFuZCBtb2RpZmljYXRpb24uXG4vL1xuLy8gRWFjaCBpbmRpdmlkdWFsIFNjaGVtYSBvYmplY3Qgc2hvdWxkIGJlIGltbXV0YWJsZS4gVGhlIGhlbHBlcnMgdG9cbi8vIGRvIHRoaW5ncyB3aXRoIHRoZSBTY2hlbWEganVzdCByZXR1cm4gYSBuZXcgc2NoZW1hIHdoZW4gdGhlIHNjaGVtYVxuLy8gaXMgY2hhbmdlZC5cbi8vXG4vLyBUaGUgY2Fub25pY2FsIHBsYWNlIHRvIHN0b3JlIHRoaXMgU2NoZW1hIGlzIGluIHRoZSBkYXRhYmFzZSBpdHNlbGYsXG4vLyBpbiBhIF9TQ0hFTUEgY29sbGVjdGlvbi4gVGhpcyBpcyBub3QgdGhlIHJpZ2h0IHdheSB0byBkbyBpdCBmb3IgYW5cbi8vIG9wZW4gc291cmNlIGZyYW1ld29yaywgYnV0IGl0J3MgYmFja3dhcmQgY29tcGF0aWJsZSwgc28gd2UncmVcbi8vIGtlZXBpbmcgaXQgdGhpcyB3YXkgZm9yIG5vdy5cbi8vXG4vLyBJbiBBUEktaGFuZGxpbmcgY29kZSwgeW91IHNob3VsZCBvbmx5IHVzZSB0aGUgU2NoZW1hIGNsYXNzIHZpYSB0aGVcbi8vIERhdGFiYXNlQ29udHJvbGxlci4gVGhpcyB3aWxsIGxldCB1cyByZXBsYWNlIHRoZSBzY2hlbWEgbG9naWMgZm9yXG4vLyBkaWZmZXJlbnQgZGF0YWJhc2VzLlxuLy8gVE9ETzogaGlkZSBhbGwgc2NoZW1hIGxvZ2ljIGluc2lkZSB0aGUgZGF0YWJhc2UgYWRhcHRlci5cbi8vIEBmbG93LWRpc2FibGUtbmV4dFxuY29uc3QgUGFyc2UgPSByZXF1aXJlKCdwYXJzZS9ub2RlJykuUGFyc2U7XG5pbXBvcnQgeyBTdG9yYWdlQWRhcHRlciB9IGZyb20gJy4uL0FkYXB0ZXJzL1N0b3JhZ2UvU3RvcmFnZUFkYXB0ZXInO1xuaW1wb3J0IERhdGFiYXNlQ29udHJvbGxlciBmcm9tICcuL0RhdGFiYXNlQ29udHJvbGxlcic7XG5pbXBvcnQgQ29uZmlnIGZyb20gJy4uL0NvbmZpZyc7XG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmltcG9ydCBkZWVwY29weSBmcm9tICdkZWVwY29weSc7XG5pbXBvcnQgdHlwZSB7XG4gIFNjaGVtYSxcbiAgU2NoZW1hRmllbGRzLFxuICBDbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gIFNjaGVtYUZpZWxkLFxuICBMb2FkU2NoZW1hT3B0aW9ucyxcbn0gZnJvbSAnLi90eXBlcyc7XG5cbmNvbnN0IGRlZmF1bHRDb2x1bW5zOiB7IFtzdHJpbmddOiBTY2hlbWFGaWVsZHMgfSA9IE9iamVjdC5mcmVlemUoe1xuICAvLyBDb250YWluIHRoZSBkZWZhdWx0IGNvbHVtbnMgZm9yIGV2ZXJ5IHBhcnNlIG9iamVjdCB0eXBlIChleGNlcHQgX0pvaW4gY29sbGVjdGlvbilcbiAgX0RlZmF1bHQ6IHtcbiAgICBvYmplY3RJZDogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGNyZWF0ZWRBdDogeyB0eXBlOiAnRGF0ZScgfSxcbiAgICB1cGRhdGVkQXQ6IHsgdHlwZTogJ0RhdGUnIH0sXG4gICAgQUNMOiB7IHR5cGU6ICdBQ0wnIH0sXG4gIH0sXG4gIC8vIFRoZSBhZGRpdGlvbmFsIGRlZmF1bHQgY29sdW1ucyBmb3IgdGhlIF9Vc2VyIGNvbGxlY3Rpb24gKGluIGFkZGl0aW9uIHRvIERlZmF1bHRDb2xzKVxuICBfVXNlcjoge1xuICAgIHVzZXJuYW1lOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgcGFzc3dvcmQ6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBlbWFpbDogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGVtYWlsVmVyaWZpZWQ6IHsgdHlwZTogJ0Jvb2xlYW4nIH0sXG4gICAgYXV0aERhdGE6IHsgdHlwZTogJ09iamVjdCcgfSxcbiAgfSxcbiAgLy8gVGhlIGFkZGl0aW9uYWwgZGVmYXVsdCBjb2x1bW5zIGZvciB0aGUgX0luc3RhbGxhdGlvbiBjb2xsZWN0aW9uIChpbiBhZGRpdGlvbiB0byBEZWZhdWx0Q29scylcbiAgX0luc3RhbGxhdGlvbjoge1xuICAgIGluc3RhbGxhdGlvbklkOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgZGV2aWNlVG9rZW46IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBjaGFubmVsczogeyB0eXBlOiAnQXJyYXknIH0sXG4gICAgZGV2aWNlVHlwZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHB1c2hUeXBlOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgR0NNU2VuZGVySWQ6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICB0aW1lWm9uZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGxvY2FsZUlkZW50aWZpZXI6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBiYWRnZTogeyB0eXBlOiAnTnVtYmVyJyB9LFxuICAgIGFwcFZlcnNpb246IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBhcHBOYW1lOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgYXBwSWRlbnRpZmllcjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHBhcnNlVmVyc2lvbjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICB9LFxuICAvLyBUaGUgYWRkaXRpb25hbCBkZWZhdWx0IGNvbHVtbnMgZm9yIHRoZSBfUm9sZSBjb2xsZWN0aW9uIChpbiBhZGRpdGlvbiB0byBEZWZhdWx0Q29scylcbiAgX1JvbGU6IHtcbiAgICBuYW1lOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgdXNlcnM6IHsgdHlwZTogJ1JlbGF0aW9uJywgdGFyZ2V0Q2xhc3M6ICdfVXNlcicgfSxcbiAgICByb2xlczogeyB0eXBlOiAnUmVsYXRpb24nLCB0YXJnZXRDbGFzczogJ19Sb2xlJyB9LFxuICB9LFxuICAvLyBUaGUgYWRkaXRpb25hbCBkZWZhdWx0IGNvbHVtbnMgZm9yIHRoZSBfU2Vzc2lvbiBjb2xsZWN0aW9uIChpbiBhZGRpdGlvbiB0byBEZWZhdWx0Q29scylcbiAgX1Nlc3Npb246IHtcbiAgICByZXN0cmljdGVkOiB7IHR5cGU6ICdCb29sZWFuJyB9LFxuICAgIHVzZXI6IHsgdHlwZTogJ1BvaW50ZXInLCB0YXJnZXRDbGFzczogJ19Vc2VyJyB9LFxuICAgIGluc3RhbGxhdGlvbklkOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgc2Vzc2lvblRva2VuOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgZXhwaXJlc0F0OiB7IHR5cGU6ICdEYXRlJyB9LFxuICAgIGNyZWF0ZWRXaXRoOiB7IHR5cGU6ICdPYmplY3QnIH0sXG4gIH0sXG4gIF9Qcm9kdWN0OiB7XG4gICAgcHJvZHVjdElkZW50aWZpZXI6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBkb3dubG9hZDogeyB0eXBlOiAnRmlsZScgfSxcbiAgICBkb3dubG9hZE5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBpY29uOiB7IHR5cGU6ICdGaWxlJyB9LFxuICAgIG9yZGVyOiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gICAgdGl0bGU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBzdWJ0aXRsZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICB9LFxuICBfUHVzaFN0YXR1czoge1xuICAgIHB1c2hUaW1lOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgc291cmNlOiB7IHR5cGU6ICdTdHJpbmcnIH0sIC8vIHJlc3Qgb3Igd2VidWlcbiAgICBxdWVyeTogeyB0eXBlOiAnU3RyaW5nJyB9LCAvLyB0aGUgc3RyaW5naWZpZWQgSlNPTiBxdWVyeVxuICAgIHBheWxvYWQ6IHsgdHlwZTogJ1N0cmluZycgfSwgLy8gdGhlIHN0cmluZ2lmaWVkIEpTT04gcGF5bG9hZCxcbiAgICB0aXRsZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGV4cGlyeTogeyB0eXBlOiAnTnVtYmVyJyB9LFxuICAgIGV4cGlyYXRpb25faW50ZXJ2YWw6IHsgdHlwZTogJ051bWJlcicgfSxcbiAgICBzdGF0dXM6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBudW1TZW50OiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gICAgbnVtRmFpbGVkOiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gICAgcHVzaEhhc2g6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBlcnJvck1lc3NhZ2U6IHsgdHlwZTogJ09iamVjdCcgfSxcbiAgICBzZW50UGVyVHlwZTogeyB0eXBlOiAnT2JqZWN0JyB9LFxuICAgIGZhaWxlZFBlclR5cGU6IHsgdHlwZTogJ09iamVjdCcgfSxcbiAgICBzZW50UGVyVVRDT2Zmc2V0OiB7IHR5cGU6ICdPYmplY3QnIH0sXG4gICAgZmFpbGVkUGVyVVRDT2Zmc2V0OiB7IHR5cGU6ICdPYmplY3QnIH0sXG4gICAgY291bnQ6IHsgdHlwZTogJ051bWJlcicgfSwgLy8gdHJhY2tzICMgb2YgYmF0Y2hlcyBxdWV1ZWQgYW5kIHBlbmRpbmdcbiAgfSxcbiAgX0pvYlN0YXR1czoge1xuICAgIGpvYk5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBzb3VyY2U6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBzdGF0dXM6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBtZXNzYWdlOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgcGFyYW1zOiB7IHR5cGU6ICdPYmplY3QnIH0sIC8vIHBhcmFtcyByZWNlaXZlZCB3aGVuIGNhbGxpbmcgdGhlIGpvYlxuICAgIGZpbmlzaGVkQXQ6IHsgdHlwZTogJ0RhdGUnIH0sXG4gIH0sXG4gIF9Kb2JTY2hlZHVsZToge1xuICAgIGpvYk5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBkZXNjcmlwdGlvbjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHBhcmFtczogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHN0YXJ0QWZ0ZXI6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBkYXlzT2ZXZWVrOiB7IHR5cGU6ICdBcnJheScgfSxcbiAgICB0aW1lT2ZEYXk6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBsYXN0UnVuOiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gICAgcmVwZWF0TWludXRlczogeyB0eXBlOiAnTnVtYmVyJyB9LFxuICB9LFxuICBfSG9va3M6IHtcbiAgICBmdW5jdGlvbk5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBjbGFzc05hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICB0cmlnZ2VyTmFtZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHVybDogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICB9LFxuICBfR2xvYmFsQ29uZmlnOiB7XG4gICAgb2JqZWN0SWQ6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBwYXJhbXM6IHsgdHlwZTogJ09iamVjdCcgfSxcbiAgfSxcbiAgX0F1ZGllbmNlOiB7XG4gICAgb2JqZWN0SWQ6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBuYW1lOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgcXVlcnk6IHsgdHlwZTogJ1N0cmluZycgfSwgLy9zdG9yaW5nIHF1ZXJ5IGFzIEpTT04gc3RyaW5nIHRvIHByZXZlbnQgXCJOZXN0ZWQga2V5cyBzaG91bGQgbm90IGNvbnRhaW4gdGhlICckJyBvciAnLicgY2hhcmFjdGVyc1wiIGVycm9yXG4gICAgbGFzdFVzZWQ6IHsgdHlwZTogJ0RhdGUnIH0sXG4gICAgdGltZXNVc2VkOiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gIH0sXG59KTtcblxuY29uc3QgcmVxdWlyZWRDb2x1bW5zID0gT2JqZWN0LmZyZWV6ZSh7XG4gIF9Qcm9kdWN0OiBbJ3Byb2R1Y3RJZGVudGlmaWVyJywgJ2ljb24nLCAnb3JkZXInLCAndGl0bGUnLCAnc3VidGl0bGUnXSxcbiAgX1JvbGU6IFsnbmFtZScsICdBQ0wnXSxcbn0pO1xuXG5jb25zdCBzeXN0ZW1DbGFzc2VzID0gT2JqZWN0LmZyZWV6ZShbXG4gICdfVXNlcicsXG4gICdfSW5zdGFsbGF0aW9uJyxcbiAgJ19Sb2xlJyxcbiAgJ19TZXNzaW9uJyxcbiAgJ19Qcm9kdWN0JyxcbiAgJ19QdXNoU3RhdHVzJyxcbiAgJ19Kb2JTdGF0dXMnLFxuICAnX0pvYlNjaGVkdWxlJyxcbiAgJ19BdWRpZW5jZScsXG5dKTtcblxuY29uc3Qgdm9sYXRpbGVDbGFzc2VzID0gT2JqZWN0LmZyZWV6ZShbXG4gICdfSm9iU3RhdHVzJyxcbiAgJ19QdXNoU3RhdHVzJyxcbiAgJ19Ib29rcycsXG4gICdfR2xvYmFsQ29uZmlnJyxcbiAgJ19Kb2JTY2hlZHVsZScsXG4gICdfQXVkaWVuY2UnLFxuXSk7XG5cbi8vIDEwIGFscGhhIG51bWJlcmljIGNoYXJzICsgdXBwZXJjYXNlXG5jb25zdCB1c2VySWRSZWdleCA9IC9eW2EtekEtWjAtOV17MTB9JC87XG4vLyBBbnl0aGluZyB0aGF0IHN0YXJ0IHdpdGggcm9sZVxuY29uc3Qgcm9sZVJlZ2V4ID0gL15yb2xlOi4qLztcbi8vICogcGVybWlzc2lvblxuY29uc3QgcHVibGljUmVnZXggPSAvXlxcKiQvO1xuXG5jb25zdCByZXF1aXJlQXV0aGVudGljYXRpb25SZWdleCA9IC9ecmVxdWlyZXNBdXRoZW50aWNhdGlvbiQvO1xuXG5jb25zdCBwZXJtaXNzaW9uS2V5UmVnZXggPSBPYmplY3QuZnJlZXplKFtcbiAgdXNlcklkUmVnZXgsXG4gIHJvbGVSZWdleCxcbiAgcHVibGljUmVnZXgsXG4gIHJlcXVpcmVBdXRoZW50aWNhdGlvblJlZ2V4LFxuXSk7XG5cbmZ1bmN0aW9uIHZlcmlmeVBlcm1pc3Npb25LZXkoa2V5KSB7XG4gIGNvbnN0IHJlc3VsdCA9IHBlcm1pc3Npb25LZXlSZWdleC5yZWR1Y2UoKGlzR29vZCwgcmVnRXgpID0+IHtcbiAgICBpc0dvb2QgPSBpc0dvb2QgfHwga2V5Lm1hdGNoKHJlZ0V4KSAhPSBudWxsO1xuICAgIHJldHVybiBpc0dvb2Q7XG4gIH0sIGZhbHNlKTtcbiAgaWYgKCFyZXN1bHQpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICBgJyR7a2V5fScgaXMgbm90IGEgdmFsaWQga2V5IGZvciBjbGFzcyBsZXZlbCBwZXJtaXNzaW9uc2BcbiAgICApO1xuICB9XG59XG5cbmNvbnN0IENMUFZhbGlkS2V5cyA9IE9iamVjdC5mcmVlemUoW1xuICAnZmluZCcsXG4gICdjb3VudCcsXG4gICdnZXQnLFxuICAnY3JlYXRlJyxcbiAgJ3VwZGF0ZScsXG4gICdkZWxldGUnLFxuICAnYWRkRmllbGQnLFxuICAncmVhZFVzZXJGaWVsZHMnLFxuICAnd3JpdGVVc2VyRmllbGRzJyxcbiAgJ3Byb3RlY3RlZEZpZWxkcycsXG5dKTtcbmZ1bmN0aW9uIHZhbGlkYXRlQ0xQKHBlcm1zOiBDbGFzc0xldmVsUGVybWlzc2lvbnMsIGZpZWxkczogU2NoZW1hRmllbGRzKSB7XG4gIGlmICghcGVybXMpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgT2JqZWN0LmtleXMocGVybXMpLmZvckVhY2gob3BlcmF0aW9uID0+IHtcbiAgICBpZiAoQ0xQVmFsaWRLZXlzLmluZGV4T2Yob3BlcmF0aW9uKSA9PSAtMSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgIGAke29wZXJhdGlvbn0gaXMgbm90IGEgdmFsaWQgb3BlcmF0aW9uIGZvciBjbGFzcyBsZXZlbCBwZXJtaXNzaW9uc2BcbiAgICAgICk7XG4gICAgfVxuICAgIGlmICghcGVybXNbb3BlcmF0aW9uXSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChvcGVyYXRpb24gPT09ICdyZWFkVXNlckZpZWxkcycgfHwgb3BlcmF0aW9uID09PSAnd3JpdGVVc2VyRmllbGRzJykge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHBlcm1zW29wZXJhdGlvbl0pKSB7XG4gICAgICAgIC8vIEBmbG93LWRpc2FibGUtbmV4dFxuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGAnJHtcbiAgICAgICAgICAgIHBlcm1zW29wZXJhdGlvbl1cbiAgICAgICAgICB9JyBpcyBub3QgYSB2YWxpZCB2YWx1ZSBmb3IgY2xhc3MgbGV2ZWwgcGVybWlzc2lvbnMgJHtvcGVyYXRpb259YFxuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcGVybXNbb3BlcmF0aW9uXS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgICAgaWYgKFxuICAgICAgICAgICAgIWZpZWxkc1trZXldIHx8XG4gICAgICAgICAgICBmaWVsZHNba2V5XS50eXBlICE9ICdQb2ludGVyJyB8fFxuICAgICAgICAgICAgZmllbGRzW2tleV0udGFyZ2V0Q2xhc3MgIT0gJ19Vc2VyJ1xuICAgICAgICAgICkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICAgIGAnJHtrZXl9JyBpcyBub3QgYSB2YWxpZCBjb2x1bW4gZm9yIGNsYXNzIGxldmVsIHBvaW50ZXIgcGVybWlzc2lvbnMgJHtvcGVyYXRpb259YFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEBmbG93LWRpc2FibGUtbmV4dFxuICAgIE9iamVjdC5rZXlzKHBlcm1zW29wZXJhdGlvbl0pLmZvckVhY2goa2V5ID0+IHtcbiAgICAgIHZlcmlmeVBlcm1pc3Npb25LZXkoa2V5KTtcbiAgICAgIC8vIEBmbG93LWRpc2FibGUtbmV4dFxuICAgICAgY29uc3QgcGVybSA9IHBlcm1zW29wZXJhdGlvbl1ba2V5XTtcbiAgICAgIGlmIChcbiAgICAgICAgcGVybSAhPT0gdHJ1ZSAmJlxuICAgICAgICAob3BlcmF0aW9uICE9PSAncHJvdGVjdGVkRmllbGRzJyB8fCAhQXJyYXkuaXNBcnJheShwZXJtKSlcbiAgICAgICkge1xuICAgICAgICAvLyBAZmxvdy1kaXNhYmxlLW5leHRcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICBgJyR7cGVybX0nIGlzIG5vdCBhIHZhbGlkIHZhbHVlIGZvciBjbGFzcyBsZXZlbCBwZXJtaXNzaW9ucyAke29wZXJhdGlvbn06JHtrZXl9OiR7cGVybX1gXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xufVxuY29uc3Qgam9pbkNsYXNzUmVnZXggPSAvXl9Kb2luOltBLVphLXowLTlfXSs6W0EtWmEtejAtOV9dKy87XG5jb25zdCBjbGFzc0FuZEZpZWxkUmVnZXggPSAvXltBLVphLXpdW0EtWmEtejAtOV9dKiQvO1xuZnVuY3Rpb24gY2xhc3NOYW1lSXNWYWxpZChjbGFzc05hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAvLyBWYWxpZCBjbGFzc2VzIG11c3Q6XG4gIHJldHVybiAoXG4gICAgLy8gQmUgb25lIG9mIF9Vc2VyLCBfSW5zdGFsbGF0aW9uLCBfUm9sZSwgX1Nlc3Npb24gT1JcbiAgICBzeXN0ZW1DbGFzc2VzLmluZGV4T2YoY2xhc3NOYW1lKSA+IC0xIHx8XG4gICAgLy8gQmUgYSBqb2luIHRhYmxlIE9SXG4gICAgam9pbkNsYXNzUmVnZXgudGVzdChjbGFzc05hbWUpIHx8XG4gICAgLy8gSW5jbHVkZSBvbmx5IGFscGhhLW51bWVyaWMgYW5kIHVuZGVyc2NvcmVzLCBhbmQgbm90IHN0YXJ0IHdpdGggYW4gdW5kZXJzY29yZSBvciBudW1iZXJcbiAgICBmaWVsZE5hbWVJc1ZhbGlkKGNsYXNzTmFtZSlcbiAgKTtcbn1cblxuLy8gVmFsaWQgZmllbGRzIG11c3QgYmUgYWxwaGEtbnVtZXJpYywgYW5kIG5vdCBzdGFydCB3aXRoIGFuIHVuZGVyc2NvcmUgb3IgbnVtYmVyXG5mdW5jdGlvbiBmaWVsZE5hbWVJc1ZhbGlkKGZpZWxkTmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBjbGFzc0FuZEZpZWxkUmVnZXgudGVzdChmaWVsZE5hbWUpO1xufVxuXG4vLyBDaGVja3MgdGhhdCBpdCdzIG5vdCB0cnlpbmcgdG8gY2xvYmJlciBvbmUgb2YgdGhlIGRlZmF1bHQgZmllbGRzIG9mIHRoZSBjbGFzcy5cbmZ1bmN0aW9uIGZpZWxkTmFtZUlzVmFsaWRGb3JDbGFzcyhcbiAgZmllbGROYW1lOiBzdHJpbmcsXG4gIGNsYXNzTmFtZTogc3RyaW5nXG4pOiBib29sZWFuIHtcbiAgaWYgKCFmaWVsZE5hbWVJc1ZhbGlkKGZpZWxkTmFtZSkpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKGRlZmF1bHRDb2x1bW5zLl9EZWZhdWx0W2ZpZWxkTmFtZV0pIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKGRlZmF1bHRDb2x1bW5zW2NsYXNzTmFtZV0gJiYgZGVmYXVsdENvbHVtbnNbY2xhc3NOYW1lXVtmaWVsZE5hbWVdKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiB0cnVlO1xufVxuXG5mdW5jdGlvbiBpbnZhbGlkQ2xhc3NOYW1lTWVzc2FnZShjbGFzc05hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiAoXG4gICAgJ0ludmFsaWQgY2xhc3NuYW1lOiAnICtcbiAgICBjbGFzc05hbWUgK1xuICAgICcsIGNsYXNzbmFtZXMgY2FuIG9ubHkgaGF2ZSBhbHBoYW51bWVyaWMgY2hhcmFjdGVycyBhbmQgXywgYW5kIG11c3Qgc3RhcnQgd2l0aCBhbiBhbHBoYSBjaGFyYWN0ZXIgJ1xuICApO1xufVxuXG5jb25zdCBpbnZhbGlkSnNvbkVycm9yID0gbmV3IFBhcnNlLkVycm9yKFxuICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICdpbnZhbGlkIEpTT04nXG4pO1xuY29uc3QgdmFsaWROb25SZWxhdGlvbk9yUG9pbnRlclR5cGVzID0gW1xuICAnTnVtYmVyJyxcbiAgJ1N0cmluZycsXG4gICdCb29sZWFuJyxcbiAgJ0RhdGUnLFxuICAnT2JqZWN0JyxcbiAgJ0FycmF5JyxcbiAgJ0dlb1BvaW50JyxcbiAgJ0ZpbGUnLFxuICAnQnl0ZXMnLFxuICAnUG9seWdvbicsXG5dO1xuLy8gUmV0dXJucyBhbiBlcnJvciBzdWl0YWJsZSBmb3IgdGhyb3dpbmcgaWYgdGhlIHR5cGUgaXMgaW52YWxpZFxuY29uc3QgZmllbGRUeXBlSXNJbnZhbGlkID0gKHsgdHlwZSwgdGFyZ2V0Q2xhc3MgfSkgPT4ge1xuICBpZiAoWydQb2ludGVyJywgJ1JlbGF0aW9uJ10uaW5kZXhPZih0eXBlKSA+PSAwKSB7XG4gICAgaWYgKCF0YXJnZXRDbGFzcykge1xuICAgICAgcmV0dXJuIG5ldyBQYXJzZS5FcnJvcigxMzUsIGB0eXBlICR7dHlwZX0gbmVlZHMgYSBjbGFzcyBuYW1lYCk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgdGFyZ2V0Q2xhc3MgIT09ICdzdHJpbmcnKSB7XG4gICAgICByZXR1cm4gaW52YWxpZEpzb25FcnJvcjtcbiAgICB9IGVsc2UgaWYgKCFjbGFzc05hbWVJc1ZhbGlkKHRhcmdldENsYXNzKSkge1xuICAgICAgcmV0dXJuIG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9DTEFTU19OQU1FLFxuICAgICAgICBpbnZhbGlkQ2xhc3NOYW1lTWVzc2FnZSh0YXJnZXRDbGFzcylcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICB9XG4gIGlmICh0eXBlb2YgdHlwZSAhPT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gaW52YWxpZEpzb25FcnJvcjtcbiAgfVxuICBpZiAodmFsaWROb25SZWxhdGlvbk9yUG9pbnRlclR5cGVzLmluZGV4T2YodHlwZSkgPCAwKSB7XG4gICAgcmV0dXJuIG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLklOQ09SUkVDVF9UWVBFLFxuICAgICAgYGludmFsaWQgZmllbGQgdHlwZTogJHt0eXBlfWBcbiAgICApO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59O1xuXG5jb25zdCBjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hID0gKHNjaGVtYTogYW55KSA9PiB7XG4gIHNjaGVtYSA9IGluamVjdERlZmF1bHRTY2hlbWEoc2NoZW1hKTtcbiAgZGVsZXRlIHNjaGVtYS5maWVsZHMuQUNMO1xuICBzY2hlbWEuZmllbGRzLl9ycGVybSA9IHsgdHlwZTogJ0FycmF5JyB9O1xuICBzY2hlbWEuZmllbGRzLl93cGVybSA9IHsgdHlwZTogJ0FycmF5JyB9O1xuXG4gIGlmIChzY2hlbWEuY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgZGVsZXRlIHNjaGVtYS5maWVsZHMucGFzc3dvcmQ7XG4gICAgc2NoZW1hLmZpZWxkcy5faGFzaGVkX3Bhc3N3b3JkID0geyB0eXBlOiAnU3RyaW5nJyB9O1xuICB9XG5cbiAgcmV0dXJuIHNjaGVtYTtcbn07XG5cbmNvbnN0IGNvbnZlcnRBZGFwdGVyU2NoZW1hVG9QYXJzZVNjaGVtYSA9ICh7IC4uLnNjaGVtYSB9KSA9PiB7XG4gIGRlbGV0ZSBzY2hlbWEuZmllbGRzLl9ycGVybTtcbiAgZGVsZXRlIHNjaGVtYS5maWVsZHMuX3dwZXJtO1xuXG4gIHNjaGVtYS5maWVsZHMuQUNMID0geyB0eXBlOiAnQUNMJyB9O1xuXG4gIGlmIChzY2hlbWEuY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgZGVsZXRlIHNjaGVtYS5maWVsZHMuYXV0aERhdGE7IC8vQXV0aCBkYXRhIGlzIGltcGxpY2l0XG4gICAgZGVsZXRlIHNjaGVtYS5maWVsZHMuX2hhc2hlZF9wYXNzd29yZDtcbiAgICBzY2hlbWEuZmllbGRzLnBhc3N3b3JkID0geyB0eXBlOiAnU3RyaW5nJyB9O1xuICB9XG5cbiAgaWYgKHNjaGVtYS5pbmRleGVzICYmIE9iamVjdC5rZXlzKHNjaGVtYS5pbmRleGVzKS5sZW5ndGggPT09IDApIHtcbiAgICBkZWxldGUgc2NoZW1hLmluZGV4ZXM7XG4gIH1cblxuICByZXR1cm4gc2NoZW1hO1xufTtcblxuY2xhc3MgU2NoZW1hRGF0YSB7XG4gIF9fZGF0YTogYW55O1xuICBfX3Byb3RlY3RlZEZpZWxkczogYW55O1xuICBjb25zdHJ1Y3RvcihhbGxTY2hlbWFzID0gW10sIHByb3RlY3RlZEZpZWxkcyA9IHt9KSB7XG4gICAgdGhpcy5fX2RhdGEgPSB7fTtcbiAgICB0aGlzLl9fcHJvdGVjdGVkRmllbGRzID0gcHJvdGVjdGVkRmllbGRzO1xuICAgIGFsbFNjaGVtYXMuZm9yRWFjaChzY2hlbWEgPT4ge1xuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRoaXMsIHNjaGVtYS5jbGFzc05hbWUsIHtcbiAgICAgICAgZ2V0OiAoKSA9PiB7XG4gICAgICAgICAgaWYgKCF0aGlzLl9fZGF0YVtzY2hlbWEuY2xhc3NOYW1lXSkge1xuICAgICAgICAgICAgY29uc3QgZGF0YSA9IHt9O1xuICAgICAgICAgICAgZGF0YS5maWVsZHMgPSBpbmplY3REZWZhdWx0U2NoZW1hKHNjaGVtYSkuZmllbGRzO1xuICAgICAgICAgICAgZGF0YS5jbGFzc0xldmVsUGVybWlzc2lvbnMgPSBkZWVwY29weShzY2hlbWEuY2xhc3NMZXZlbFBlcm1pc3Npb25zKTtcbiAgICAgICAgICAgIGRhdGEuaW5kZXhlcyA9IHNjaGVtYS5pbmRleGVzO1xuXG4gICAgICAgICAgICBjb25zdCBjbGFzc1Byb3RlY3RlZEZpZWxkcyA9IHRoaXMuX19wcm90ZWN0ZWRGaWVsZHNbXG4gICAgICAgICAgICAgIHNjaGVtYS5jbGFzc05hbWVcbiAgICAgICAgICAgIF07XG4gICAgICAgICAgICBpZiAoY2xhc3NQcm90ZWN0ZWRGaWVsZHMpIHtcbiAgICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gY2xhc3NQcm90ZWN0ZWRGaWVsZHMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB1bnEgPSBuZXcgU2V0KFtcbiAgICAgICAgICAgICAgICAgIC4uLihkYXRhLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucy5wcm90ZWN0ZWRGaWVsZHNba2V5XSB8fCBbXSksXG4gICAgICAgICAgICAgICAgICAuLi5jbGFzc1Byb3RlY3RlZEZpZWxkc1trZXldLFxuICAgICAgICAgICAgICAgIF0pO1xuICAgICAgICAgICAgICAgIGRhdGEuY2xhc3NMZXZlbFBlcm1pc3Npb25zLnByb3RlY3RlZEZpZWxkc1trZXldID0gQXJyYXkuZnJvbShcbiAgICAgICAgICAgICAgICAgIHVucVxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5fX2RhdGFbc2NoZW1hLmNsYXNzTmFtZV0gPSBkYXRhO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gdGhpcy5fX2RhdGFbc2NoZW1hLmNsYXNzTmFtZV07XG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIEluamVjdCB0aGUgaW4tbWVtb3J5IGNsYXNzZXNcbiAgICB2b2xhdGlsZUNsYXNzZXMuZm9yRWFjaChjbGFzc05hbWUgPT4ge1xuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRoaXMsIGNsYXNzTmFtZSwge1xuICAgICAgICBnZXQ6ICgpID0+IHtcbiAgICAgICAgICBpZiAoIXRoaXMuX19kYXRhW2NsYXNzTmFtZV0pIHtcbiAgICAgICAgICAgIGNvbnN0IHNjaGVtYSA9IGluamVjdERlZmF1bHRTY2hlbWEoe1xuICAgICAgICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgICAgICAgIGZpZWxkczoge30sXG4gICAgICAgICAgICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczoge30sXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGNvbnN0IGRhdGEgPSB7fTtcbiAgICAgICAgICAgIGRhdGEuZmllbGRzID0gc2NoZW1hLmZpZWxkcztcbiAgICAgICAgICAgIGRhdGEuY2xhc3NMZXZlbFBlcm1pc3Npb25zID0gc2NoZW1hLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucztcbiAgICAgICAgICAgIGRhdGEuaW5kZXhlcyA9IHNjaGVtYS5pbmRleGVzO1xuICAgICAgICAgICAgdGhpcy5fX2RhdGFbY2xhc3NOYW1lXSA9IGRhdGE7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiB0aGlzLl9fZGF0YVtjbGFzc05hbWVdO1xuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbn1cblxuY29uc3QgaW5qZWN0RGVmYXVsdFNjaGVtYSA9ICh7XG4gIGNsYXNzTmFtZSxcbiAgZmllbGRzLFxuICBjbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gIGluZGV4ZXMsXG59OiBTY2hlbWEpID0+IHtcbiAgY29uc3QgZGVmYXVsdFNjaGVtYTogU2NoZW1hID0ge1xuICAgIGNsYXNzTmFtZSxcbiAgICBmaWVsZHM6IHtcbiAgICAgIC4uLmRlZmF1bHRDb2x1bW5zLl9EZWZhdWx0LFxuICAgICAgLi4uKGRlZmF1bHRDb2x1bW5zW2NsYXNzTmFtZV0gfHwge30pLFxuICAgICAgLi4uZmllbGRzLFxuICAgIH0sXG4gICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zLFxuICB9O1xuICBpZiAoaW5kZXhlcyAmJiBPYmplY3Qua2V5cyhpbmRleGVzKS5sZW5ndGggIT09IDApIHtcbiAgICBkZWZhdWx0U2NoZW1hLmluZGV4ZXMgPSBpbmRleGVzO1xuICB9XG4gIHJldHVybiBkZWZhdWx0U2NoZW1hO1xufTtcblxuY29uc3QgX0hvb2tzU2NoZW1hID0geyBjbGFzc05hbWU6ICdfSG9va3MnLCBmaWVsZHM6IGRlZmF1bHRDb2x1bW5zLl9Ib29rcyB9O1xuY29uc3QgX0dsb2JhbENvbmZpZ1NjaGVtYSA9IHtcbiAgY2xhc3NOYW1lOiAnX0dsb2JhbENvbmZpZycsXG4gIGZpZWxkczogZGVmYXVsdENvbHVtbnMuX0dsb2JhbENvbmZpZyxcbn07XG5jb25zdCBfUHVzaFN0YXR1c1NjaGVtYSA9IGNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEoXG4gIGluamVjdERlZmF1bHRTY2hlbWEoe1xuICAgIGNsYXNzTmFtZTogJ19QdXNoU3RhdHVzJyxcbiAgICBmaWVsZHM6IHt9LFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczoge30sXG4gIH0pXG4pO1xuY29uc3QgX0pvYlN0YXR1c1NjaGVtYSA9IGNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEoXG4gIGluamVjdERlZmF1bHRTY2hlbWEoe1xuICAgIGNsYXNzTmFtZTogJ19Kb2JTdGF0dXMnLFxuICAgIGZpZWxkczoge30sXG4gICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiB7fSxcbiAgfSlcbik7XG5jb25zdCBfSm9iU2NoZWR1bGVTY2hlbWEgPSBjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hKFxuICBpbmplY3REZWZhdWx0U2NoZW1hKHtcbiAgICBjbGFzc05hbWU6ICdfSm9iU2NoZWR1bGUnLFxuICAgIGZpZWxkczoge30sXG4gICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiB7fSxcbiAgfSlcbik7XG5jb25zdCBfQXVkaWVuY2VTY2hlbWEgPSBjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hKFxuICBpbmplY3REZWZhdWx0U2NoZW1hKHtcbiAgICBjbGFzc05hbWU6ICdfQXVkaWVuY2UnLFxuICAgIGZpZWxkczogZGVmYXVsdENvbHVtbnMuX0F1ZGllbmNlLFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczoge30sXG4gIH0pXG4pO1xuY29uc3QgVm9sYXRpbGVDbGFzc2VzU2NoZW1hcyA9IFtcbiAgX0hvb2tzU2NoZW1hLFxuICBfSm9iU3RhdHVzU2NoZW1hLFxuICBfSm9iU2NoZWR1bGVTY2hlbWEsXG4gIF9QdXNoU3RhdHVzU2NoZW1hLFxuICBfR2xvYmFsQ29uZmlnU2NoZW1hLFxuICBfQXVkaWVuY2VTY2hlbWEsXG5dO1xuXG5jb25zdCBkYlR5cGVNYXRjaGVzT2JqZWN0VHlwZSA9IChcbiAgZGJUeXBlOiBTY2hlbWFGaWVsZCB8IHN0cmluZyxcbiAgb2JqZWN0VHlwZTogU2NoZW1hRmllbGRcbikgPT4ge1xuICBpZiAoZGJUeXBlLnR5cGUgIT09IG9iamVjdFR5cGUudHlwZSkgcmV0dXJuIGZhbHNlO1xuICBpZiAoZGJUeXBlLnRhcmdldENsYXNzICE9PSBvYmplY3RUeXBlLnRhcmdldENsYXNzKSByZXR1cm4gZmFsc2U7XG4gIGlmIChkYlR5cGUgPT09IG9iamVjdFR5cGUudHlwZSkgcmV0dXJuIHRydWU7XG4gIGlmIChkYlR5cGUudHlwZSA9PT0gb2JqZWN0VHlwZS50eXBlKSByZXR1cm4gdHJ1ZTtcbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuY29uc3QgdHlwZVRvU3RyaW5nID0gKHR5cGU6IFNjaGVtYUZpZWxkIHwgc3RyaW5nKTogc3RyaW5nID0+IHtcbiAgaWYgKHR5cGVvZiB0eXBlID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiB0eXBlO1xuICB9XG4gIGlmICh0eXBlLnRhcmdldENsYXNzKSB7XG4gICAgcmV0dXJuIGAke3R5cGUudHlwZX08JHt0eXBlLnRhcmdldENsYXNzfT5gO1xuICB9XG4gIHJldHVybiBgJHt0eXBlLnR5cGV9YDtcbn07XG5cbi8vIFN0b3JlcyB0aGUgZW50aXJlIHNjaGVtYSBvZiB0aGUgYXBwIGluIGEgd2VpcmQgaHlicmlkIGZvcm1hdCBzb21ld2hlcmUgYmV0d2VlblxuLy8gdGhlIG1vbmdvIGZvcm1hdCBhbmQgdGhlIFBhcnNlIGZvcm1hdC4gU29vbiwgdGhpcyB3aWxsIGFsbCBiZSBQYXJzZSBmb3JtYXQuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTY2hlbWFDb250cm9sbGVyIHtcbiAgX2RiQWRhcHRlcjogU3RvcmFnZUFkYXB0ZXI7XG4gIHNjaGVtYURhdGE6IHsgW3N0cmluZ106IFNjaGVtYSB9O1xuICBfY2FjaGU6IGFueTtcbiAgcmVsb2FkRGF0YVByb21pc2U6IFByb21pc2U8YW55PjtcbiAgcHJvdGVjdGVkRmllbGRzOiBhbnk7XG5cbiAgY29uc3RydWN0b3IoZGF0YWJhc2VBZGFwdGVyOiBTdG9yYWdlQWRhcHRlciwgc2NoZW1hQ2FjaGU6IGFueSkge1xuICAgIHRoaXMuX2RiQWRhcHRlciA9IGRhdGFiYXNlQWRhcHRlcjtcbiAgICB0aGlzLl9jYWNoZSA9IHNjaGVtYUNhY2hlO1xuICAgIHRoaXMuc2NoZW1hRGF0YSA9IG5ldyBTY2hlbWFEYXRhKCk7XG4gICAgdGhpcy5wcm90ZWN0ZWRGaWVsZHMgPSBDb25maWcuZ2V0KFBhcnNlLmFwcGxpY2F0aW9uSWQpLnByb3RlY3RlZEZpZWxkcztcbiAgfVxuXG4gIHJlbG9hZERhdGEob3B0aW9uczogTG9hZFNjaGVtYU9wdGlvbnMgPSB7IGNsZWFyQ2FjaGU6IGZhbHNlIH0pOiBQcm9taXNlPGFueT4ge1xuICAgIGxldCBwcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgaWYgKG9wdGlvbnMuY2xlYXJDYWNoZSkge1xuICAgICAgcHJvbWlzZSA9IHByb21pc2UudGhlbigoKSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLl9jYWNoZS5jbGVhcigpO1xuICAgICAgfSk7XG4gICAgfVxuICAgIGlmICh0aGlzLnJlbG9hZERhdGFQcm9taXNlICYmICFvcHRpb25zLmNsZWFyQ2FjaGUpIHtcbiAgICAgIHJldHVybiB0aGlzLnJlbG9hZERhdGFQcm9taXNlO1xuICAgIH1cbiAgICB0aGlzLnJlbG9hZERhdGFQcm9taXNlID0gcHJvbWlzZVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRBbGxDbGFzc2VzKG9wdGlvbnMpLnRoZW4oXG4gICAgICAgICAgYWxsU2NoZW1hcyA9PiB7XG4gICAgICAgICAgICB0aGlzLnNjaGVtYURhdGEgPSBuZXcgU2NoZW1hRGF0YShhbGxTY2hlbWFzLCB0aGlzLnByb3RlY3RlZEZpZWxkcyk7XG4gICAgICAgICAgICBkZWxldGUgdGhpcy5yZWxvYWREYXRhUHJvbWlzZTtcbiAgICAgICAgICB9LFxuICAgICAgICAgIGVyciA9PiB7XG4gICAgICAgICAgICB0aGlzLnNjaGVtYURhdGEgPSBuZXcgU2NoZW1hRGF0YSgpO1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMucmVsb2FkRGF0YVByb21pc2U7XG4gICAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgICAgfVxuICAgICAgICApO1xuICAgICAgfSlcbiAgICAgIC50aGVuKCgpID0+IHt9KTtcbiAgICByZXR1cm4gdGhpcy5yZWxvYWREYXRhUHJvbWlzZTtcbiAgfVxuXG4gIGdldEFsbENsYXNzZXMoXG4gICAgb3B0aW9uczogTG9hZFNjaGVtYU9wdGlvbnMgPSB7IGNsZWFyQ2FjaGU6IGZhbHNlIH1cbiAgKTogUHJvbWlzZTxBcnJheTxTY2hlbWE+PiB7XG4gICAgbGV0IHByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKTtcbiAgICBpZiAob3B0aW9ucy5jbGVhckNhY2hlKSB7XG4gICAgICBwcm9taXNlID0gdGhpcy5fY2FjaGUuY2xlYXIoKTtcbiAgICB9XG4gICAgcmV0dXJuIHByb21pc2VcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2NhY2hlLmdldEFsbENsYXNzZXMoKTtcbiAgICAgIH0pXG4gICAgICAudGhlbihhbGxDbGFzc2VzID0+IHtcbiAgICAgICAgaWYgKGFsbENsYXNzZXMgJiYgYWxsQ2xhc3Nlcy5sZW5ndGggJiYgIW9wdGlvbnMuY2xlYXJDYWNoZSkge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoYWxsQ2xhc3Nlcyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX2RiQWRhcHRlclxuICAgICAgICAgIC5nZXRBbGxDbGFzc2VzKClcbiAgICAgICAgICAudGhlbihhbGxTY2hlbWFzID0+IGFsbFNjaGVtYXMubWFwKGluamVjdERlZmF1bHRTY2hlbWEpKVxuICAgICAgICAgIC50aGVuKGFsbFNjaGVtYXMgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2NhY2hlLnNldEFsbENsYXNzZXMoYWxsU2NoZW1hcykudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgIHJldHVybiBhbGxTY2hlbWFzO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgfVxuXG4gIGdldE9uZVNjaGVtYShcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBhbGxvd1ZvbGF0aWxlQ2xhc3NlczogYm9vbGVhbiA9IGZhbHNlLFxuICAgIG9wdGlvbnM6IExvYWRTY2hlbWFPcHRpb25zID0geyBjbGVhckNhY2hlOiBmYWxzZSB9XG4gICk6IFByb21pc2U8U2NoZW1hPiB7XG4gICAgbGV0IHByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKTtcbiAgICBpZiAob3B0aW9ucy5jbGVhckNhY2hlKSB7XG4gICAgICBwcm9taXNlID0gdGhpcy5fY2FjaGUuY2xlYXIoKTtcbiAgICB9XG4gICAgcmV0dXJuIHByb21pc2UudGhlbigoKSA9PiB7XG4gICAgICBpZiAoYWxsb3dWb2xhdGlsZUNsYXNzZXMgJiYgdm9sYXRpbGVDbGFzc2VzLmluZGV4T2YoY2xhc3NOYW1lKSA+IC0xKSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSB0aGlzLnNjaGVtYURhdGFbY2xhc3NOYW1lXTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7XG4gICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgIGZpZWxkczogZGF0YS5maWVsZHMsXG4gICAgICAgICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiBkYXRhLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgICAgICAgICBpbmRleGVzOiBkYXRhLmluZGV4ZXMsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXMuX2NhY2hlLmdldE9uZVNjaGVtYShjbGFzc05hbWUpLnRoZW4oY2FjaGVkID0+IHtcbiAgICAgICAgaWYgKGNhY2hlZCAmJiAhb3B0aW9ucy5jbGVhckNhY2hlKSB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShjYWNoZWQpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9kYkFkYXB0ZXJcbiAgICAgICAgICAuZ2V0Q2xhc3MoY2xhc3NOYW1lKVxuICAgICAgICAgIC50aGVuKGluamVjdERlZmF1bHRTY2hlbWEpXG4gICAgICAgICAgLnRoZW4ocmVzdWx0ID0+IHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9jYWNoZS5zZXRPbmVTY2hlbWEoY2xhc3NOYW1lLCByZXN1bHQpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIENyZWF0ZSBhIG5ldyBjbGFzcyB0aGF0IGluY2x1ZGVzIHRoZSB0aHJlZSBkZWZhdWx0IGZpZWxkcy5cbiAgLy8gQUNMIGlzIGFuIGltcGxpY2l0IGNvbHVtbiB0aGF0IGRvZXMgbm90IGdldCBhbiBlbnRyeSBpbiB0aGVcbiAgLy8gX1NDSEVNQVMgZGF0YWJhc2UuIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2l0aCB0aGVcbiAgLy8gY3JlYXRlZCBzY2hlbWEsIGluIG1vbmdvIGZvcm1hdC5cbiAgLy8gb24gc3VjY2VzcywgYW5kIHJlamVjdHMgd2l0aCBhbiBlcnJvciBvbiBmYWlsLiBFbnN1cmUgeW91XG4gIC8vIGhhdmUgYXV0aG9yaXphdGlvbiAobWFzdGVyIGtleSwgb3IgY2xpZW50IGNsYXNzIGNyZWF0aW9uXG4gIC8vIGVuYWJsZWQpIGJlZm9yZSBjYWxsaW5nIHRoaXMgZnVuY3Rpb24uXG4gIGFkZENsYXNzSWZOb3RFeGlzdHMoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgZmllbGRzOiBTY2hlbWFGaWVsZHMgPSB7fSxcbiAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IGFueSxcbiAgICBpbmRleGVzOiBhbnkgPSB7fVxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB2YXIgdmFsaWRhdGlvbkVycm9yID0gdGhpcy52YWxpZGF0ZU5ld0NsYXNzKFxuICAgICAgY2xhc3NOYW1lLFxuICAgICAgZmllbGRzLFxuICAgICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zXG4gICAgKTtcbiAgICBpZiAodmFsaWRhdGlvbkVycm9yKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QodmFsaWRhdGlvbkVycm9yKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fZGJBZGFwdGVyXG4gICAgICAuY3JlYXRlQ2xhc3MoXG4gICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgY29udmVydFNjaGVtYVRvQWRhcHRlclNjaGVtYSh7XG4gICAgICAgICAgZmllbGRzLFxuICAgICAgICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgICAgICAgICBpbmRleGVzLFxuICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgfSlcbiAgICAgIClcbiAgICAgIC50aGVuKGNvbnZlcnRBZGFwdGVyU2NoZW1hVG9QYXJzZVNjaGVtYSlcbiAgICAgIC50aGVuKHJlcyA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLl9jYWNoZS5jbGVhcigpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocmVzKTtcbiAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yICYmIGVycm9yLmNvZGUgPT09IFBhcnNlLkVycm9yLkRVUExJQ0FURV9WQUxVRSkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfQ0xBU1NfTkFNRSxcbiAgICAgICAgICAgIGBDbGFzcyAke2NsYXNzTmFtZX0gYWxyZWFkeSBleGlzdHMuYFxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9XG5cbiAgdXBkYXRlQ2xhc3MoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgc3VibWl0dGVkRmllbGRzOiBTY2hlbWFGaWVsZHMsXG4gICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiBhbnksXG4gICAgaW5kZXhlczogYW55LFxuICAgIGRhdGFiYXNlOiBEYXRhYmFzZUNvbnRyb2xsZXJcbiAgKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0T25lU2NoZW1hKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKHNjaGVtYSA9PiB7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nRmllbGRzID0gc2NoZW1hLmZpZWxkcztcbiAgICAgICAgT2JqZWN0LmtleXMoc3VibWl0dGVkRmllbGRzKS5mb3JFYWNoKG5hbWUgPT4ge1xuICAgICAgICAgIGNvbnN0IGZpZWxkID0gc3VibWl0dGVkRmllbGRzW25hbWVdO1xuICAgICAgICAgIGlmIChleGlzdGluZ0ZpZWxkc1tuYW1lXSAmJiBmaWVsZC5fX29wICE9PSAnRGVsZXRlJykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDI1NSwgYEZpZWxkICR7bmFtZX0gZXhpc3RzLCBjYW5ub3QgdXBkYXRlLmApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoIWV4aXN0aW5nRmllbGRzW25hbWVdICYmIGZpZWxkLl9fb3AgPT09ICdEZWxldGUnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgIDI1NSxcbiAgICAgICAgICAgICAgYEZpZWxkICR7bmFtZX0gZG9lcyBub3QgZXhpc3QsIGNhbm5vdCBkZWxldGUuYFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGRlbGV0ZSBleGlzdGluZ0ZpZWxkcy5fcnBlcm07XG4gICAgICAgIGRlbGV0ZSBleGlzdGluZ0ZpZWxkcy5fd3Blcm07XG4gICAgICAgIGNvbnN0IG5ld1NjaGVtYSA9IGJ1aWxkTWVyZ2VkU2NoZW1hT2JqZWN0KFxuICAgICAgICAgIGV4aXN0aW5nRmllbGRzLFxuICAgICAgICAgIHN1Ym1pdHRlZEZpZWxkc1xuICAgICAgICApO1xuICAgICAgICBjb25zdCBkZWZhdWx0RmllbGRzID1cbiAgICAgICAgICBkZWZhdWx0Q29sdW1uc1tjbGFzc05hbWVdIHx8IGRlZmF1bHRDb2x1bW5zLl9EZWZhdWx0O1xuICAgICAgICBjb25zdCBmdWxsTmV3U2NoZW1hID0gT2JqZWN0LmFzc2lnbih7fSwgbmV3U2NoZW1hLCBkZWZhdWx0RmllbGRzKTtcbiAgICAgICAgY29uc3QgdmFsaWRhdGlvbkVycm9yID0gdGhpcy52YWxpZGF0ZVNjaGVtYURhdGEoXG4gICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgIG5ld1NjaGVtYSxcbiAgICAgICAgICBjbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gICAgICAgICAgT2JqZWN0LmtleXMoZXhpc3RpbmdGaWVsZHMpXG4gICAgICAgICk7XG4gICAgICAgIGlmICh2YWxpZGF0aW9uRXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IodmFsaWRhdGlvbkVycm9yLmNvZGUsIHZhbGlkYXRpb25FcnJvci5lcnJvcik7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGaW5hbGx5IHdlIGhhdmUgY2hlY2tlZCB0byBtYWtlIHN1cmUgdGhlIHJlcXVlc3QgaXMgdmFsaWQgYW5kIHdlIGNhbiBzdGFydCBkZWxldGluZyBmaWVsZHMuXG4gICAgICAgIC8vIERvIGFsbCBkZWxldGlvbnMgZmlyc3QsIHRoZW4gYSBzaW5nbGUgc2F2ZSB0byBfU0NIRU1BIGNvbGxlY3Rpb24gdG8gaGFuZGxlIGFsbCBhZGRpdGlvbnMuXG4gICAgICAgIGNvbnN0IGRlbGV0ZWRGaWVsZHM6IHN0cmluZ1tdID0gW107XG4gICAgICAgIGNvbnN0IGluc2VydGVkRmllbGRzID0gW107XG4gICAgICAgIE9iamVjdC5rZXlzKHN1Ym1pdHRlZEZpZWxkcykuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgICAgICAgIGlmIChzdWJtaXR0ZWRGaWVsZHNbZmllbGROYW1lXS5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICAgICAgZGVsZXRlZEZpZWxkcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGluc2VydGVkRmllbGRzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGxldCBkZWxldGVQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIGlmIChkZWxldGVkRmllbGRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBkZWxldGVQcm9taXNlID0gdGhpcy5kZWxldGVGaWVsZHMoZGVsZXRlZEZpZWxkcywgY2xhc3NOYW1lLCBkYXRhYmFzZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICBkZWxldGVQcm9taXNlIC8vIERlbGV0ZSBFdmVyeXRoaW5nXG4gICAgICAgICAgICAudGhlbigoKSA9PiB0aGlzLnJlbG9hZERhdGEoeyBjbGVhckNhY2hlOiB0cnVlIH0pKSAvLyBSZWxvYWQgb3VyIFNjaGVtYSwgc28gd2UgaGF2ZSBhbGwgdGhlIG5ldyB2YWx1ZXNcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgcHJvbWlzZXMgPSBpbnNlcnRlZEZpZWxkcy5tYXAoZmllbGROYW1lID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCB0eXBlID0gc3VibWl0dGVkRmllbGRzW2ZpZWxkTmFtZV07XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZW5mb3JjZUZpZWxkRXhpc3RzKGNsYXNzTmFtZSwgZmllbGROYW1lLCB0eXBlKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIHJldHVybiBQcm9taXNlLmFsbChwcm9taXNlcyk7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLnRoZW4oKCkgPT5cbiAgICAgICAgICAgICAgdGhpcy5zZXRQZXJtaXNzaW9ucyhjbGFzc05hbWUsIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucywgbmV3U2NoZW1hKVxuICAgICAgICAgICAgKVxuICAgICAgICAgICAgLnRoZW4oKCkgPT5cbiAgICAgICAgICAgICAgdGhpcy5fZGJBZGFwdGVyLnNldEluZGV4ZXNXaXRoU2NoZW1hRm9ybWF0KFxuICAgICAgICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgICBpbmRleGVzLFxuICAgICAgICAgICAgICAgIHNjaGVtYS5pbmRleGVzLFxuICAgICAgICAgICAgICAgIGZ1bGxOZXdTY2hlbWFcbiAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKVxuICAgICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5yZWxvYWREYXRhKHsgY2xlYXJDYWNoZTogdHJ1ZSB9KSlcbiAgICAgICAgICAgIC8vVE9ETzogTW92ZSB0aGlzIGxvZ2ljIGludG8gdGhlIGRhdGFiYXNlIGFkYXB0ZXJcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5zY2hlbWFEYXRhW2NsYXNzTmFtZV07XG4gICAgICAgICAgICAgIGNvbnN0IHJlbG9hZGVkU2NoZW1hOiBTY2hlbWEgPSB7XG4gICAgICAgICAgICAgICAgY2xhc3NOYW1lOiBjbGFzc05hbWUsXG4gICAgICAgICAgICAgICAgZmllbGRzOiBzY2hlbWEuZmllbGRzLFxuICAgICAgICAgICAgICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczogc2NoZW1hLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgaWYgKHNjaGVtYS5pbmRleGVzICYmIE9iamVjdC5rZXlzKHNjaGVtYS5pbmRleGVzKS5sZW5ndGggIT09IDApIHtcbiAgICAgICAgICAgICAgICByZWxvYWRlZFNjaGVtYS5pbmRleGVzID0gc2NoZW1hLmluZGV4ZXM7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgcmV0dXJuIHJlbG9hZGVkU2NoZW1hO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgKTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfQ0xBU1NfTkFNRSxcbiAgICAgICAgICAgIGBDbGFzcyAke2NsYXNzTmFtZX0gZG9lcyBub3QgZXhpc3QuYFxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9XG5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyBzdWNjZXNzZnVsbHkgdG8gdGhlIG5ldyBzY2hlbWFcbiAgLy8gb2JqZWN0IG9yIGZhaWxzIHdpdGggYSByZWFzb24uXG4gIGVuZm9yY2VDbGFzc0V4aXN0cyhjbGFzc05hbWU6IHN0cmluZyk6IFByb21pc2U8U2NoZW1hQ29udHJvbGxlcj4ge1xuICAgIGlmICh0aGlzLnNjaGVtYURhdGFbY2xhc3NOYW1lXSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzKTtcbiAgICB9XG4gICAgLy8gV2UgZG9uJ3QgaGF2ZSB0aGlzIGNsYXNzLiBVcGRhdGUgdGhlIHNjaGVtYVxuICAgIHJldHVybiAoXG4gICAgICB0aGlzLmFkZENsYXNzSWZOb3RFeGlzdHMoY2xhc3NOYW1lKVxuICAgICAgICAvLyBUaGUgc2NoZW1hIHVwZGF0ZSBzdWNjZWVkZWQuIFJlbG9hZCB0aGUgc2NoZW1hXG4gICAgICAgIC50aGVuKCgpID0+IHRoaXMucmVsb2FkRGF0YSh7IGNsZWFyQ2FjaGU6IHRydWUgfSkpXG4gICAgICAgIC5jYXRjaCgoKSA9PiB7XG4gICAgICAgICAgLy8gVGhlIHNjaGVtYSB1cGRhdGUgZmFpbGVkLiBUaGlzIGNhbiBiZSBva2F5IC0gaXQgbWlnaHRcbiAgICAgICAgICAvLyBoYXZlIGZhaWxlZCBiZWNhdXNlIHRoZXJlJ3MgYSByYWNlIGNvbmRpdGlvbiBhbmQgYSBkaWZmZXJlbnRcbiAgICAgICAgICAvLyBjbGllbnQgaXMgbWFraW5nIHRoZSBleGFjdCBzYW1lIHNjaGVtYSB1cGRhdGUgdGhhdCB3ZSB3YW50LlxuICAgICAgICAgIC8vIFNvIGp1c3QgcmVsb2FkIHRoZSBzY2hlbWEuXG4gICAgICAgICAgcmV0dXJuIHRoaXMucmVsb2FkRGF0YSh7IGNsZWFyQ2FjaGU6IHRydWUgfSk7XG4gICAgICAgIH0pXG4gICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAvLyBFbnN1cmUgdGhhdCB0aGUgc2NoZW1hIG5vdyB2YWxpZGF0ZXNcbiAgICAgICAgICBpZiAodGhpcy5zY2hlbWFEYXRhW2NsYXNzTmFtZV0pIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICAgYEZhaWxlZCB0byBhZGQgJHtjbGFzc05hbWV9YFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICAgIC5jYXRjaCgoKSA9PiB7XG4gICAgICAgICAgLy8gVGhlIHNjaGVtYSBzdGlsbCBkb2Vzbid0IHZhbGlkYXRlLiBHaXZlIHVwXG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgJ3NjaGVtYSBjbGFzcyBuYW1lIGRvZXMgbm90IHJldmFsaWRhdGUnXG4gICAgICAgICAgKTtcbiAgICAgICAgfSlcbiAgICApO1xuICB9XG5cbiAgdmFsaWRhdGVOZXdDbGFzcyhcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBmaWVsZHM6IFNjaGVtYUZpZWxkcyA9IHt9LFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczogYW55XG4gICk6IGFueSB7XG4gICAgaWYgKHRoaXMuc2NoZW1hRGF0YVtjbGFzc05hbWVdKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfQ0xBU1NfTkFNRSxcbiAgICAgICAgYENsYXNzICR7Y2xhc3NOYW1lfSBhbHJlYWR5IGV4aXN0cy5gXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoIWNsYXNzTmFtZUlzVmFsaWQoY2xhc3NOYW1lKSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29kZTogUGFyc2UuRXJyb3IuSU5WQUxJRF9DTEFTU19OQU1FLFxuICAgICAgICBlcnJvcjogaW52YWxpZENsYXNzTmFtZU1lc3NhZ2UoY2xhc3NOYW1lKSxcbiAgICAgIH07XG4gICAgfVxuICAgIHJldHVybiB0aGlzLnZhbGlkYXRlU2NoZW1hRGF0YShcbiAgICAgIGNsYXNzTmFtZSxcbiAgICAgIGZpZWxkcyxcbiAgICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgICAgIFtdXG4gICAgKTtcbiAgfVxuXG4gIHZhbGlkYXRlU2NoZW1hRGF0YShcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBmaWVsZHM6IFNjaGVtYUZpZWxkcyxcbiAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IENsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgICBleGlzdGluZ0ZpZWxkTmFtZXM6IEFycmF5PHN0cmluZz5cbiAgKSB7XG4gICAgZm9yIChjb25zdCBmaWVsZE5hbWUgaW4gZmllbGRzKSB7XG4gICAgICBpZiAoZXhpc3RpbmdGaWVsZE5hbWVzLmluZGV4T2YoZmllbGROYW1lKSA8IDApIHtcbiAgICAgICAgaWYgKCFmaWVsZE5hbWVJc1ZhbGlkKGZpZWxkTmFtZSkpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY29kZTogUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSxcbiAgICAgICAgICAgIGVycm9yOiAnaW52YWxpZCBmaWVsZCBuYW1lOiAnICsgZmllbGROYW1lLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFmaWVsZE5hbWVJc1ZhbGlkRm9yQ2xhc3MoZmllbGROYW1lLCBjbGFzc05hbWUpKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGNvZGU6IDEzNixcbiAgICAgICAgICAgIGVycm9yOiAnZmllbGQgJyArIGZpZWxkTmFtZSArICcgY2Fubm90IGJlIGFkZGVkJyxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGVycm9yID0gZmllbGRUeXBlSXNJbnZhbGlkKGZpZWxkc1tmaWVsZE5hbWVdKTtcbiAgICAgICAgaWYgKGVycm9yKSByZXR1cm4geyBjb2RlOiBlcnJvci5jb2RlLCBlcnJvcjogZXJyb3IubWVzc2FnZSB9O1xuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZmllbGROYW1lIGluIGRlZmF1bHRDb2x1bW5zW2NsYXNzTmFtZV0pIHtcbiAgICAgIGZpZWxkc1tmaWVsZE5hbWVdID0gZGVmYXVsdENvbHVtbnNbY2xhc3NOYW1lXVtmaWVsZE5hbWVdO1xuICAgIH1cblxuICAgIGNvbnN0IGdlb1BvaW50cyA9IE9iamVjdC5rZXlzKGZpZWxkcykuZmlsdGVyKFxuICAgICAga2V5ID0+IGZpZWxkc1trZXldICYmIGZpZWxkc1trZXldLnR5cGUgPT09ICdHZW9Qb2ludCdcbiAgICApO1xuICAgIGlmIChnZW9Qb2ludHMubGVuZ3RoID4gMSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29kZTogUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUsXG4gICAgICAgIGVycm9yOlxuICAgICAgICAgICdjdXJyZW50bHksIG9ubHkgb25lIEdlb1BvaW50IGZpZWxkIG1heSBleGlzdCBpbiBhbiBvYmplY3QuIEFkZGluZyAnICtcbiAgICAgICAgICBnZW9Qb2ludHNbMV0gK1xuICAgICAgICAgICcgd2hlbiAnICtcbiAgICAgICAgICBnZW9Qb2ludHNbMF0gK1xuICAgICAgICAgICcgYWxyZWFkeSBleGlzdHMuJyxcbiAgICAgIH07XG4gICAgfVxuICAgIHZhbGlkYXRlQ0xQKGNsYXNzTGV2ZWxQZXJtaXNzaW9ucywgZmllbGRzKTtcbiAgfVxuXG4gIC8vIFNldHMgdGhlIENsYXNzLWxldmVsIHBlcm1pc3Npb25zIGZvciBhIGdpdmVuIGNsYXNzTmFtZSwgd2hpY2ggbXVzdCBleGlzdC5cbiAgc2V0UGVybWlzc2lvbnMoY2xhc3NOYW1lOiBzdHJpbmcsIHBlcm1zOiBhbnksIG5ld1NjaGVtYTogU2NoZW1hRmllbGRzKSB7XG4gICAgaWYgKHR5cGVvZiBwZXJtcyA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG4gICAgdmFsaWRhdGVDTFAocGVybXMsIG5ld1NjaGVtYSk7XG4gICAgcmV0dXJuIHRoaXMuX2RiQWRhcHRlci5zZXRDbGFzc0xldmVsUGVybWlzc2lvbnMoY2xhc3NOYW1lLCBwZXJtcyk7XG4gIH1cblxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHN1Y2Nlc3NmdWxseSB0byB0aGUgbmV3IHNjaGVtYVxuICAvLyBvYmplY3QgaWYgdGhlIHByb3ZpZGVkIGNsYXNzTmFtZS1maWVsZE5hbWUtdHlwZSB0dXBsZSBpcyB2YWxpZC5cbiAgLy8gVGhlIGNsYXNzTmFtZSBtdXN0IGFscmVhZHkgYmUgdmFsaWRhdGVkLlxuICAvLyBJZiAnZnJlZXplJyBpcyB0cnVlLCByZWZ1c2UgdG8gdXBkYXRlIHRoZSBzY2hlbWEgZm9yIHRoaXMgZmllbGQuXG4gIGVuZm9yY2VGaWVsZEV4aXN0cyhcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBmaWVsZE5hbWU6IHN0cmluZyxcbiAgICB0eXBlOiBzdHJpbmcgfCBTY2hlbWFGaWVsZFxuICApIHtcbiAgICBpZiAoZmllbGROYW1lLmluZGV4T2YoJy4nKSA+IDApIHtcbiAgICAgIC8vIHN1YmRvY3VtZW50IGtleSAoeC55KSA9PiBvayBpZiB4IGlzIG9mIHR5cGUgJ29iamVjdCdcbiAgICAgIGZpZWxkTmFtZSA9IGZpZWxkTmFtZS5zcGxpdCgnLicpWzBdO1xuICAgICAgdHlwZSA9ICdPYmplY3QnO1xuICAgIH1cbiAgICBpZiAoIWZpZWxkTmFtZUlzVmFsaWQoZmllbGROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLFxuICAgICAgICBgSW52YWxpZCBmaWVsZCBuYW1lOiAke2ZpZWxkTmFtZX0uYFxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBJZiBzb21lb25lIHRyaWVzIHRvIGNyZWF0ZSBhIG5ldyBmaWVsZCB3aXRoIG51bGwvdW5kZWZpbmVkIGFzIHRoZSB2YWx1ZSwgcmV0dXJuO1xuICAgIGlmICghdHlwZSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5yZWxvYWREYXRhKCkudGhlbigoKSA9PiB7XG4gICAgICBjb25zdCBleHBlY3RlZFR5cGUgPSB0aGlzLmdldEV4cGVjdGVkVHlwZShjbGFzc05hbWUsIGZpZWxkTmFtZSk7XG4gICAgICBpZiAodHlwZW9mIHR5cGUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHR5cGUgPSB7IHR5cGUgfTtcbiAgICAgIH1cblxuICAgICAgaWYgKGV4cGVjdGVkVHlwZSkge1xuICAgICAgICBpZiAoIWRiVHlwZU1hdGNoZXNPYmplY3RUeXBlKGV4cGVjdGVkVHlwZSwgdHlwZSkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5JTkNPUlJFQ1RfVFlQRSxcbiAgICAgICAgICAgIGBzY2hlbWEgbWlzbWF0Y2ggZm9yICR7Y2xhc3NOYW1lfS4ke2ZpZWxkTmFtZX07IGV4cGVjdGVkICR7dHlwZVRvU3RyaW5nKFxuICAgICAgICAgICAgICBleHBlY3RlZFR5cGVcbiAgICAgICAgICAgICl9IGJ1dCBnb3QgJHt0eXBlVG9TdHJpbmcodHlwZSl9YFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzLl9kYkFkYXB0ZXJcbiAgICAgICAgLmFkZEZpZWxkSWZOb3RFeGlzdHMoY2xhc3NOYW1lLCBmaWVsZE5hbWUsIHR5cGUpXG4gICAgICAgIC50aGVuKFxuICAgICAgICAgICgpID0+IHtcbiAgICAgICAgICAgIC8vIFRoZSB1cGRhdGUgc3VjY2VlZGVkLiBSZWxvYWQgdGhlIHNjaGVtYVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVsb2FkRGF0YSh7IGNsZWFyQ2FjaGU6IHRydWUgfSk7XG4gICAgICAgICAgfSxcbiAgICAgICAgICBlcnJvciA9PiB7XG4gICAgICAgICAgICBpZiAoZXJyb3IuY29kZSA9PSBQYXJzZS5FcnJvci5JTkNPUlJFQ1RfVFlQRSkge1xuICAgICAgICAgICAgICAvLyBNYWtlIHN1cmUgdGhhdCB3ZSB0aHJvdyBlcnJvcnMgd2hlbiBpdCBpcyBhcHByb3ByaWF0ZSB0byBkbyBzby5cbiAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBUaGUgdXBkYXRlIGZhaWxlZC4gVGhpcyBjYW4gYmUgb2theSAtIGl0IG1pZ2h0IGhhdmUgYmVlbiBhIHJhY2VcbiAgICAgICAgICAgIC8vIGNvbmRpdGlvbiB3aGVyZSBhbm90aGVyIGNsaWVudCB1cGRhdGVkIHRoZSBzY2hlbWEgaW4gdGhlIHNhbWVcbiAgICAgICAgICAgIC8vIHdheSB0aGF0IHdlIHdhbnRlZCB0by4gU28sIGp1c3QgcmVsb2FkIHRoZSBzY2hlbWFcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlbG9hZERhdGEoeyBjbGVhckNhY2hlOiB0cnVlIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgKVxuICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgLy8gRW5zdXJlIHRoYXQgdGhlIHNjaGVtYSBub3cgdmFsaWRhdGVzXG4gICAgICAgICAgY29uc3QgZXhwZWN0ZWRUeXBlID0gdGhpcy5nZXRFeHBlY3RlZFR5cGUoY2xhc3NOYW1lLCBmaWVsZE5hbWUpO1xuICAgICAgICAgIGlmICh0eXBlb2YgdHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHR5cGUgPSB7IHR5cGUgfTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKCFleHBlY3RlZFR5cGUgfHwgIWRiVHlwZU1hdGNoZXNPYmplY3RUeXBlKGV4cGVjdGVkVHlwZSwgdHlwZSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgICBgQ291bGQgbm90IGFkZCBmaWVsZCAke2ZpZWxkTmFtZX1gXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBSZW1vdmUgdGhlIGNhY2hlZCBzY2hlbWFcbiAgICAgICAgICB0aGlzLl9jYWNoZS5jbGVhcigpO1xuICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIG1haW50YWluIGNvbXBhdGliaWxpdHlcbiAgZGVsZXRlRmllbGQoXG4gICAgZmllbGROYW1lOiBzdHJpbmcsXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgZGF0YWJhc2U6IERhdGFiYXNlQ29udHJvbGxlclxuICApIHtcbiAgICByZXR1cm4gdGhpcy5kZWxldGVGaWVsZHMoW2ZpZWxkTmFtZV0sIGNsYXNzTmFtZSwgZGF0YWJhc2UpO1xuICB9XG5cbiAgLy8gRGVsZXRlIGZpZWxkcywgYW5kIHJlbW92ZSB0aGF0IGRhdGEgZnJvbSBhbGwgb2JqZWN0cy4gVGhpcyBpcyBpbnRlbmRlZFxuICAvLyB0byByZW1vdmUgdW51c2VkIGZpZWxkcywgaWYgb3RoZXIgd3JpdGVycyBhcmUgd3JpdGluZyBvYmplY3RzIHRoYXQgaW5jbHVkZVxuICAvLyB0aGlzIGZpZWxkLCB0aGUgZmllbGQgbWF5IHJlYXBwZWFyLiBSZXR1cm5zIGEgUHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGhcbiAgLy8gbm8gb2JqZWN0IG9uIHN1Y2Nlc3MsIG9yIHJlamVjdHMgd2l0aCB7IGNvZGUsIGVycm9yIH0gb24gZmFpbHVyZS5cbiAgLy8gUGFzc2luZyB0aGUgZGF0YWJhc2UgYW5kIHByZWZpeCBpcyBuZWNlc3NhcnkgaW4gb3JkZXIgdG8gZHJvcCByZWxhdGlvbiBjb2xsZWN0aW9uc1xuICAvLyBhbmQgcmVtb3ZlIGZpZWxkcyBmcm9tIG9iamVjdHMuIElkZWFsbHkgdGhlIGRhdGFiYXNlIHdvdWxkIGJlbG9uZyB0b1xuICAvLyBhIGRhdGFiYXNlIGFkYXB0ZXIgYW5kIHRoaXMgZnVuY3Rpb24gd291bGQgY2xvc2Ugb3ZlciBpdCBvciBhY2Nlc3MgaXQgdmlhIG1lbWJlci5cbiAgZGVsZXRlRmllbGRzKFxuICAgIGZpZWxkTmFtZXM6IEFycmF5PHN0cmluZz4sXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgZGF0YWJhc2U6IERhdGFiYXNlQ29udHJvbGxlclxuICApIHtcbiAgICBpZiAoIWNsYXNzTmFtZUlzVmFsaWQoY2xhc3NOYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0NMQVNTX05BTUUsXG4gICAgICAgIGludmFsaWRDbGFzc05hbWVNZXNzYWdlKGNsYXNzTmFtZSlcbiAgICAgICk7XG4gICAgfVxuXG4gICAgZmllbGROYW1lcy5mb3JFYWNoKGZpZWxkTmFtZSA9PiB7XG4gICAgICBpZiAoIWZpZWxkTmFtZUlzVmFsaWQoZmllbGROYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSxcbiAgICAgICAgICBgaW52YWxpZCBmaWVsZCBuYW1lOiAke2ZpZWxkTmFtZX1gXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICAvL0Rvbid0IGFsbG93IGRlbGV0aW5nIHRoZSBkZWZhdWx0IGZpZWxkcy5cbiAgICAgIGlmICghZmllbGROYW1lSXNWYWxpZEZvckNsYXNzKGZpZWxkTmFtZSwgY2xhc3NOYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoMTM2LCBgZmllbGQgJHtmaWVsZE5hbWV9IGNhbm5vdCBiZSBjaGFuZ2VkYCk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gdGhpcy5nZXRPbmVTY2hlbWEoY2xhc3NOYW1lLCBmYWxzZSwgeyBjbGVhckNhY2hlOiB0cnVlIH0pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfQ0xBU1NfTkFNRSxcbiAgICAgICAgICAgIGBDbGFzcyAke2NsYXNzTmFtZX0gZG9lcyBub3QgZXhpc3QuYFxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAudGhlbihzY2hlbWEgPT4ge1xuICAgICAgICBmaWVsZE5hbWVzLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICAgICAgICBpZiAoIXNjaGVtYS5maWVsZHNbZmllbGROYW1lXSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICAyNTUsXG4gICAgICAgICAgICAgIGBGaWVsZCAke2ZpZWxkTmFtZX0gZG9lcyBub3QgZXhpc3QsIGNhbm5vdCBkZWxldGUuYFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHNjaGVtYUZpZWxkcyA9IHsgLi4uc2NoZW1hLmZpZWxkcyB9O1xuICAgICAgICByZXR1cm4gZGF0YWJhc2UuYWRhcHRlclxuICAgICAgICAgIC5kZWxldGVGaWVsZHMoY2xhc3NOYW1lLCBzY2hlbWEsIGZpZWxkTmFtZXMpXG4gICAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKFxuICAgICAgICAgICAgICBmaWVsZE5hbWVzLm1hcChmaWVsZE5hbWUgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGZpZWxkID0gc2NoZW1hRmllbGRzW2ZpZWxkTmFtZV07XG4gICAgICAgICAgICAgICAgaWYgKGZpZWxkICYmIGZpZWxkLnR5cGUgPT09ICdSZWxhdGlvbicpIHtcbiAgICAgICAgICAgICAgICAgIC8vRm9yIHJlbGF0aW9ucywgZHJvcCB0aGUgX0pvaW4gdGFibGVcbiAgICAgICAgICAgICAgICAgIHJldHVybiBkYXRhYmFzZS5hZGFwdGVyLmRlbGV0ZUNsYXNzKFxuICAgICAgICAgICAgICAgICAgICBgX0pvaW46JHtmaWVsZE5hbWV9OiR7Y2xhc3NOYW1lfWBcbiAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICB0aGlzLl9jYWNoZS5jbGVhcigpO1xuICAgICAgfSk7XG4gIH1cblxuICAvLyBWYWxpZGF0ZXMgYW4gb2JqZWN0IHByb3ZpZGVkIGluIFJFU1QgZm9ybWF0LlxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSBuZXcgc2NoZW1hIGlmIHRoaXMgb2JqZWN0IGlzXG4gIC8vIHZhbGlkLlxuICB2YWxpZGF0ZU9iamVjdChjbGFzc05hbWU6IHN0cmluZywgb2JqZWN0OiBhbnksIHF1ZXJ5OiBhbnkpIHtcbiAgICBsZXQgZ2VvY291bnQgPSAwO1xuICAgIGxldCBwcm9taXNlID0gdGhpcy5lbmZvcmNlQ2xhc3NFeGlzdHMoY2xhc3NOYW1lKTtcbiAgICBmb3IgKGNvbnN0IGZpZWxkTmFtZSBpbiBvYmplY3QpIHtcbiAgICAgIGlmIChvYmplY3RbZmllbGROYW1lXSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgZXhwZWN0ZWQgPSBnZXRUeXBlKG9iamVjdFtmaWVsZE5hbWVdKTtcbiAgICAgIGlmIChleHBlY3RlZCA9PT0gJ0dlb1BvaW50Jykge1xuICAgICAgICBnZW9jb3VudCsrO1xuICAgICAgfVxuICAgICAgaWYgKGdlb2NvdW50ID4gMSkge1xuICAgICAgICAvLyBNYWtlIHN1cmUgYWxsIGZpZWxkIHZhbGlkYXRpb24gb3BlcmF0aW9ucyBydW4gYmVmb3JlIHdlIHJldHVybi5cbiAgICAgICAgLy8gSWYgbm90IC0gd2UgYXJlIGNvbnRpbnVpbmcgdG8gcnVuIGxvZ2ljLCBidXQgYWxyZWFkeSBwcm92aWRlZCByZXNwb25zZSBmcm9tIHRoZSBzZXJ2ZXIuXG4gICAgICAgIHJldHVybiBwcm9taXNlLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChcbiAgICAgICAgICAgIG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUsXG4gICAgICAgICAgICAgICd0aGVyZSBjYW4gb25seSBiZSBvbmUgZ2VvcG9pbnQgZmllbGQgaW4gYSBjbGFzcydcbiAgICAgICAgICAgIClcbiAgICAgICAgICApO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGlmICghZXhwZWN0ZWQpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoZmllbGROYW1lID09PSAnQUNMJykge1xuICAgICAgICAvLyBFdmVyeSBvYmplY3QgaGFzIEFDTCBpbXBsaWNpdGx5LlxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgcHJvbWlzZSA9IHByb21pc2UudGhlbihzY2hlbWEgPT5cbiAgICAgICAgc2NoZW1hLmVuZm9yY2VGaWVsZEV4aXN0cyhjbGFzc05hbWUsIGZpZWxkTmFtZSwgZXhwZWN0ZWQpXG4gICAgICApO1xuICAgIH1cbiAgICBwcm9taXNlID0gdGhlblZhbGlkYXRlUmVxdWlyZWRDb2x1bW5zKHByb21pc2UsIGNsYXNzTmFtZSwgb2JqZWN0LCBxdWVyeSk7XG4gICAgcmV0dXJuIHByb21pc2U7XG4gIH1cblxuICAvLyBWYWxpZGF0ZXMgdGhhdCBhbGwgdGhlIHByb3BlcnRpZXMgYXJlIHNldCBmb3IgdGhlIG9iamVjdFxuICB2YWxpZGF0ZVJlcXVpcmVkQ29sdW1ucyhjbGFzc05hbWU6IHN0cmluZywgb2JqZWN0OiBhbnksIHF1ZXJ5OiBhbnkpIHtcbiAgICBjb25zdCBjb2x1bW5zID0gcmVxdWlyZWRDb2x1bW5zW2NsYXNzTmFtZV07XG4gICAgaWYgKCFjb2x1bW5zIHx8IGNvbHVtbnMubGVuZ3RoID09IDApIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcyk7XG4gICAgfVxuXG4gICAgY29uc3QgbWlzc2luZ0NvbHVtbnMgPSBjb2x1bW5zLmZpbHRlcihmdW5jdGlvbihjb2x1bW4pIHtcbiAgICAgIGlmIChxdWVyeSAmJiBxdWVyeS5vYmplY3RJZCkge1xuICAgICAgICBpZiAob2JqZWN0W2NvbHVtbl0gJiYgdHlwZW9mIG9iamVjdFtjb2x1bW5dID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgIC8vIFRyeWluZyB0byBkZWxldGUgYSByZXF1aXJlZCBjb2x1bW5cbiAgICAgICAgICByZXR1cm4gb2JqZWN0W2NvbHVtbl0uX19vcCA9PSAnRGVsZXRlJztcbiAgICAgICAgfVxuICAgICAgICAvLyBOb3QgdHJ5aW5nIHRvIGRvIGFueXRoaW5nIHRoZXJlXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICAgIHJldHVybiAhb2JqZWN0W2NvbHVtbl07XG4gICAgfSk7XG5cbiAgICBpZiAobWlzc2luZ0NvbHVtbnMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTkNPUlJFQ1RfVFlQRSxcbiAgICAgICAgbWlzc2luZ0NvbHVtbnNbMF0gKyAnIGlzIHJlcXVpcmVkLidcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcyk7XG4gIH1cblxuICB0ZXN0UGVybWlzc2lvbnNGb3JDbGFzc05hbWUoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgYWNsR3JvdXA6IHN0cmluZ1tdLFxuICAgIG9wZXJhdGlvbjogc3RyaW5nXG4gICkge1xuICAgIHJldHVybiBTY2hlbWFDb250cm9sbGVyLnRlc3RQZXJtaXNzaW9ucyhcbiAgICAgIHRoaXMuZ2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zKGNsYXNzTmFtZSksXG4gICAgICBhY2xHcm91cCxcbiAgICAgIG9wZXJhdGlvblxuICAgICk7XG4gIH1cblxuICAvLyBUZXN0cyB0aGF0IHRoZSBjbGFzcyBsZXZlbCBwZXJtaXNzaW9uIGxldCBwYXNzIHRoZSBvcGVyYXRpb24gZm9yIGEgZ2l2ZW4gYWNsR3JvdXBcbiAgc3RhdGljIHRlc3RQZXJtaXNzaW9ucyhcbiAgICBjbGFzc1Blcm1pc3Npb25zOiA/YW55LFxuICAgIGFjbEdyb3VwOiBzdHJpbmdbXSxcbiAgICBvcGVyYXRpb246IHN0cmluZ1xuICApOiBib29sZWFuIHtcbiAgICBpZiAoIWNsYXNzUGVybWlzc2lvbnMgfHwgIWNsYXNzUGVybWlzc2lvbnNbb3BlcmF0aW9uXSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIGNvbnN0IHBlcm1zID0gY2xhc3NQZXJtaXNzaW9uc1tvcGVyYXRpb25dO1xuICAgIGlmIChwZXJtc1snKiddKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgLy8gQ2hlY2sgcGVybWlzc2lvbnMgYWdhaW5zdCB0aGUgYWNsR3JvdXAgcHJvdmlkZWQgKGFycmF5IG9mIHVzZXJJZC9yb2xlcylcbiAgICBpZiAoXG4gICAgICBhY2xHcm91cC5zb21lKGFjbCA9PiB7XG4gICAgICAgIHJldHVybiBwZXJtc1thY2xdID09PSB0cnVlO1xuICAgICAgfSlcbiAgICApIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvLyBWYWxpZGF0ZXMgYW4gb3BlcmF0aW9uIHBhc3NlcyBjbGFzcy1sZXZlbC1wZXJtaXNzaW9ucyBzZXQgaW4gdGhlIHNjaGVtYVxuICBzdGF0aWMgdmFsaWRhdGVQZXJtaXNzaW9uKFxuICAgIGNsYXNzUGVybWlzc2lvbnM6ID9hbnksXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgYWNsR3JvdXA6IHN0cmluZ1tdLFxuICAgIG9wZXJhdGlvbjogc3RyaW5nXG4gICkge1xuICAgIGlmIChcbiAgICAgIFNjaGVtYUNvbnRyb2xsZXIudGVzdFBlcm1pc3Npb25zKGNsYXNzUGVybWlzc2lvbnMsIGFjbEdyb3VwLCBvcGVyYXRpb24pXG4gICAgKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuXG4gICAgaWYgKCFjbGFzc1Blcm1pc3Npb25zIHx8ICFjbGFzc1Blcm1pc3Npb25zW29wZXJhdGlvbl0pIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICBjb25zdCBwZXJtcyA9IGNsYXNzUGVybWlzc2lvbnNbb3BlcmF0aW9uXTtcbiAgICAvLyBJZiBvbmx5IGZvciBhdXRoZW50aWNhdGVkIHVzZXJzXG4gICAgLy8gbWFrZSBzdXJlIHdlIGhhdmUgYW4gYWNsR3JvdXBcbiAgICBpZiAocGVybXNbJ3JlcXVpcmVzQXV0aGVudGljYXRpb24nXSkge1xuICAgICAgLy8gSWYgYWNsR3JvdXAgaGFzICogKHB1YmxpYylcbiAgICAgIGlmICghYWNsR3JvdXAgfHwgYWNsR3JvdXAubGVuZ3RoID09IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsXG4gICAgICAgICAgJ1Blcm1pc3Npb24gZGVuaWVkLCB1c2VyIG5lZWRzIHRvIGJlIGF1dGhlbnRpY2F0ZWQuJ1xuICAgICAgICApO1xuICAgICAgfSBlbHNlIGlmIChhY2xHcm91cC5pbmRleE9mKCcqJykgPiAtMSAmJiBhY2xHcm91cC5sZW5ndGggPT0gMSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCxcbiAgICAgICAgICAnUGVybWlzc2lvbiBkZW5pZWQsIHVzZXIgbmVlZHMgdG8gYmUgYXV0aGVudGljYXRlZC4nXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICAvLyByZXF1aXJlc0F1dGhlbnRpY2F0aW9uIHBhc3NlZCwganVzdCBtb3ZlIGZvcndhcmRcbiAgICAgIC8vIHByb2JhYmx5IHdvdWxkIGJlIHdpc2UgYXQgc29tZSBwb2ludCB0byByZW5hbWUgdG8gJ2F1dGhlbnRpY2F0ZWRVc2VyJ1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cblxuICAgIC8vIE5vIG1hdGNoaW5nIENMUCwgbGV0J3MgY2hlY2sgdGhlIFBvaW50ZXIgcGVybWlzc2lvbnNcbiAgICAvLyBBbmQgaGFuZGxlIHRob3NlIGxhdGVyXG4gICAgY29uc3QgcGVybWlzc2lvbkZpZWxkID1cbiAgICAgIFsnZ2V0JywgJ2ZpbmQnLCAnY291bnQnXS5pbmRleE9mKG9wZXJhdGlvbikgPiAtMVxuICAgICAgICA/ICdyZWFkVXNlckZpZWxkcydcbiAgICAgICAgOiAnd3JpdGVVc2VyRmllbGRzJztcblxuICAgIC8vIFJlamVjdCBjcmVhdGUgd2hlbiB3cml0ZSBsb2NrZG93blxuICAgIGlmIChwZXJtaXNzaW9uRmllbGQgPT0gJ3dyaXRlVXNlckZpZWxkcycgJiYgb3BlcmF0aW9uID09ICdjcmVhdGUnKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLk9QRVJBVElPTl9GT1JCSURERU4sXG4gICAgICAgIGBQZXJtaXNzaW9uIGRlbmllZCBmb3IgYWN0aW9uICR7b3BlcmF0aW9ufSBvbiBjbGFzcyAke2NsYXNzTmFtZX0uYFxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBQcm9jZXNzIHRoZSByZWFkVXNlckZpZWxkcyBsYXRlclxuICAgIGlmIChcbiAgICAgIEFycmF5LmlzQXJyYXkoY2xhc3NQZXJtaXNzaW9uc1twZXJtaXNzaW9uRmllbGRdKSAmJlxuICAgICAgY2xhc3NQZXJtaXNzaW9uc1twZXJtaXNzaW9uRmllbGRdLmxlbmd0aCA+IDBcbiAgICApIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgIGBQZXJtaXNzaW9uIGRlbmllZCBmb3IgYWN0aW9uICR7b3BlcmF0aW9ufSBvbiBjbGFzcyAke2NsYXNzTmFtZX0uYFxuICAgICk7XG4gIH1cblxuICAvLyBWYWxpZGF0ZXMgYW4gb3BlcmF0aW9uIHBhc3NlcyBjbGFzcy1sZXZlbC1wZXJtaXNzaW9ucyBzZXQgaW4gdGhlIHNjaGVtYVxuICB2YWxpZGF0ZVBlcm1pc3Npb24oY2xhc3NOYW1lOiBzdHJpbmcsIGFjbEdyb3VwOiBzdHJpbmdbXSwgb3BlcmF0aW9uOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gU2NoZW1hQ29udHJvbGxlci52YWxpZGF0ZVBlcm1pc3Npb24oXG4gICAgICB0aGlzLmdldENsYXNzTGV2ZWxQZXJtaXNzaW9ucyhjbGFzc05hbWUpLFxuICAgICAgY2xhc3NOYW1lLFxuICAgICAgYWNsR3JvdXAsXG4gICAgICBvcGVyYXRpb25cbiAgICApO1xuICB9XG5cbiAgZ2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zKGNsYXNzTmFtZTogc3RyaW5nKTogYW55IHtcbiAgICByZXR1cm4gKFxuICAgICAgdGhpcy5zY2hlbWFEYXRhW2NsYXNzTmFtZV0gJiZcbiAgICAgIHRoaXMuc2NoZW1hRGF0YVtjbGFzc05hbWVdLmNsYXNzTGV2ZWxQZXJtaXNzaW9uc1xuICAgICk7XG4gIH1cblxuICAvLyBSZXR1cm5zIHRoZSBleHBlY3RlZCB0eXBlIGZvciBhIGNsYXNzTmFtZStrZXkgY29tYmluYXRpb25cbiAgLy8gb3IgdW5kZWZpbmVkIGlmIHRoZSBzY2hlbWEgaXMgbm90IHNldFxuICBnZXRFeHBlY3RlZFR5cGUoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgZmllbGROYW1lOiBzdHJpbmdcbiAgKTogPyhTY2hlbWFGaWVsZCB8IHN0cmluZykge1xuICAgIGlmICh0aGlzLnNjaGVtYURhdGFbY2xhc3NOYW1lXSkge1xuICAgICAgY29uc3QgZXhwZWN0ZWRUeXBlID0gdGhpcy5zY2hlbWFEYXRhW2NsYXNzTmFtZV0uZmllbGRzW2ZpZWxkTmFtZV07XG4gICAgICByZXR1cm4gZXhwZWN0ZWRUeXBlID09PSAnbWFwJyA/ICdPYmplY3QnIDogZXhwZWN0ZWRUeXBlO1xuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgLy8gQ2hlY2tzIGlmIGEgZ2l2ZW4gY2xhc3MgaXMgaW4gdGhlIHNjaGVtYS5cbiAgaGFzQ2xhc3MoY2xhc3NOYW1lOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5yZWxvYWREYXRhKCkudGhlbigoKSA9PiAhIXRoaXMuc2NoZW1hRGF0YVtjbGFzc05hbWVdKTtcbiAgfVxufVxuXG4vLyBSZXR1cm5zIGEgcHJvbWlzZSBmb3IgYSBuZXcgU2NoZW1hLlxuY29uc3QgbG9hZCA9IChcbiAgZGJBZGFwdGVyOiBTdG9yYWdlQWRhcHRlcixcbiAgc2NoZW1hQ2FjaGU6IGFueSxcbiAgb3B0aW9uczogYW55XG4pOiBQcm9taXNlPFNjaGVtYUNvbnRyb2xsZXI+ID0+IHtcbiAgY29uc3Qgc2NoZW1hID0gbmV3IFNjaGVtYUNvbnRyb2xsZXIoZGJBZGFwdGVyLCBzY2hlbWFDYWNoZSk7XG4gIHJldHVybiBzY2hlbWEucmVsb2FkRGF0YShvcHRpb25zKS50aGVuKCgpID0+IHNjaGVtYSk7XG59O1xuXG4vLyBCdWlsZHMgYSBuZXcgc2NoZW1hIChpbiBzY2hlbWEgQVBJIHJlc3BvbnNlIGZvcm1hdCkgb3V0IG9mIGFuXG4vLyBleGlzdGluZyBtb25nbyBzY2hlbWEgKyBhIHNjaGVtYXMgQVBJIHB1dCByZXF1ZXN0LiBUaGlzIHJlc3BvbnNlXG4vLyBkb2VzIG5vdCBpbmNsdWRlIHRoZSBkZWZhdWx0IGZpZWxkcywgYXMgaXQgaXMgaW50ZW5kZWQgdG8gYmUgcGFzc2VkXG4vLyB0byBtb25nb1NjaGVtYUZyb21GaWVsZHNBbmRDbGFzc05hbWUuIE5vIHZhbGlkYXRpb24gaXMgZG9uZSBoZXJlLCBpdFxuLy8gaXMgZG9uZSBpbiBtb25nb1NjaGVtYUZyb21GaWVsZHNBbmRDbGFzc05hbWUuXG5mdW5jdGlvbiBidWlsZE1lcmdlZFNjaGVtYU9iamVjdChcbiAgZXhpc3RpbmdGaWVsZHM6IFNjaGVtYUZpZWxkcyxcbiAgcHV0UmVxdWVzdDogYW55XG4pOiBTY2hlbWFGaWVsZHMge1xuICBjb25zdCBuZXdTY2hlbWEgPSB7fTtcbiAgLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG4gIGNvbnN0IHN5c1NjaGVtYUZpZWxkID1cbiAgICBPYmplY3Qua2V5cyhkZWZhdWx0Q29sdW1ucykuaW5kZXhPZihleGlzdGluZ0ZpZWxkcy5faWQpID09PSAtMVxuICAgICAgPyBbXVxuICAgICAgOiBPYmplY3Qua2V5cyhkZWZhdWx0Q29sdW1uc1tleGlzdGluZ0ZpZWxkcy5faWRdKTtcbiAgZm9yIChjb25zdCBvbGRGaWVsZCBpbiBleGlzdGluZ0ZpZWxkcykge1xuICAgIGlmIChcbiAgICAgIG9sZEZpZWxkICE9PSAnX2lkJyAmJlxuICAgICAgb2xkRmllbGQgIT09ICdBQ0wnICYmXG4gICAgICBvbGRGaWVsZCAhPT0gJ3VwZGF0ZWRBdCcgJiZcbiAgICAgIG9sZEZpZWxkICE9PSAnY3JlYXRlZEF0JyAmJlxuICAgICAgb2xkRmllbGQgIT09ICdvYmplY3RJZCdcbiAgICApIHtcbiAgICAgIGlmIChcbiAgICAgICAgc3lzU2NoZW1hRmllbGQubGVuZ3RoID4gMCAmJlxuICAgICAgICBzeXNTY2hlbWFGaWVsZC5pbmRleE9mKG9sZEZpZWxkKSAhPT0gLTFcbiAgICAgICkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGZpZWxkSXNEZWxldGVkID1cbiAgICAgICAgcHV0UmVxdWVzdFtvbGRGaWVsZF0gJiYgcHV0UmVxdWVzdFtvbGRGaWVsZF0uX19vcCA9PT0gJ0RlbGV0ZSc7XG4gICAgICBpZiAoIWZpZWxkSXNEZWxldGVkKSB7XG4gICAgICAgIG5ld1NjaGVtYVtvbGRGaWVsZF0gPSBleGlzdGluZ0ZpZWxkc1tvbGRGaWVsZF07XG4gICAgICB9XG4gICAgfVxuICB9XG4gIGZvciAoY29uc3QgbmV3RmllbGQgaW4gcHV0UmVxdWVzdCkge1xuICAgIGlmIChuZXdGaWVsZCAhPT0gJ29iamVjdElkJyAmJiBwdXRSZXF1ZXN0W25ld0ZpZWxkXS5fX29wICE9PSAnRGVsZXRlJykge1xuICAgICAgaWYgKFxuICAgICAgICBzeXNTY2hlbWFGaWVsZC5sZW5ndGggPiAwICYmXG4gICAgICAgIHN5c1NjaGVtYUZpZWxkLmluZGV4T2YobmV3RmllbGQpICE9PSAtMVxuICAgICAgKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgbmV3U2NoZW1hW25ld0ZpZWxkXSA9IHB1dFJlcXVlc3RbbmV3RmllbGRdO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbmV3U2NoZW1hO1xufVxuXG4vLyBHaXZlbiBhIHNjaGVtYSBwcm9taXNlLCBjb25zdHJ1Y3QgYW5vdGhlciBzY2hlbWEgcHJvbWlzZSB0aGF0XG4vLyB2YWxpZGF0ZXMgdGhpcyBmaWVsZCBvbmNlIHRoZSBzY2hlbWEgbG9hZHMuXG5mdW5jdGlvbiB0aGVuVmFsaWRhdGVSZXF1aXJlZENvbHVtbnMoc2NoZW1hUHJvbWlzZSwgY2xhc3NOYW1lLCBvYmplY3QsIHF1ZXJ5KSB7XG4gIHJldHVybiBzY2hlbWFQcm9taXNlLnRoZW4oc2NoZW1hID0+IHtcbiAgICByZXR1cm4gc2NoZW1hLnZhbGlkYXRlUmVxdWlyZWRDb2x1bW5zKGNsYXNzTmFtZSwgb2JqZWN0LCBxdWVyeSk7XG4gIH0pO1xufVxuXG4vLyBHZXRzIHRoZSB0eXBlIGZyb20gYSBSRVNUIEFQSSBmb3JtYXR0ZWQgb2JqZWN0LCB3aGVyZSAndHlwZScgaXNcbi8vIGV4dGVuZGVkIHBhc3QgamF2YXNjcmlwdCB0eXBlcyB0byBpbmNsdWRlIHRoZSByZXN0IG9mIHRoZSBQYXJzZVxuLy8gdHlwZSBzeXN0ZW0uXG4vLyBUaGUgb3V0cHV0IHNob3VsZCBiZSBhIHZhbGlkIHNjaGVtYSB2YWx1ZS5cbi8vIFRPRE86IGVuc3VyZSB0aGF0IHRoaXMgaXMgY29tcGF0aWJsZSB3aXRoIHRoZSBmb3JtYXQgdXNlZCBpbiBPcGVuIERCXG5mdW5jdGlvbiBnZXRUeXBlKG9iajogYW55KTogPyhTY2hlbWFGaWVsZCB8IHN0cmluZykge1xuICBjb25zdCB0eXBlID0gdHlwZW9mIG9iajtcbiAgc3dpdGNoICh0eXBlKSB7XG4gICAgY2FzZSAnYm9vbGVhbic6XG4gICAgICByZXR1cm4gJ0Jvb2xlYW4nO1xuICAgIGNhc2UgJ3N0cmluZyc6XG4gICAgICByZXR1cm4gJ1N0cmluZyc7XG4gICAgY2FzZSAnbnVtYmVyJzpcbiAgICAgIHJldHVybiAnTnVtYmVyJztcbiAgICBjYXNlICdtYXAnOlxuICAgIGNhc2UgJ29iamVjdCc6XG4gICAgICBpZiAoIW9iaikge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGdldE9iamVjdFR5cGUob2JqKTtcbiAgICBjYXNlICdmdW5jdGlvbic6XG4gICAgY2FzZSAnc3ltYm9sJzpcbiAgICBjYXNlICd1bmRlZmluZWQnOlxuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyAnYmFkIG9iajogJyArIG9iajtcbiAgfVxufVxuXG4vLyBUaGlzIGdldHMgdGhlIHR5cGUgZm9yIG5vbi1KU09OIHR5cGVzIGxpa2UgcG9pbnRlcnMgYW5kIGZpbGVzLCBidXRcbi8vIGFsc28gZ2V0cyB0aGUgYXBwcm9wcmlhdGUgdHlwZSBmb3IgJCBvcGVyYXRvcnMuXG4vLyBSZXR1cm5zIG51bGwgaWYgdGhlIHR5cGUgaXMgdW5rbm93bi5cbmZ1bmN0aW9uIGdldE9iamVjdFR5cGUob2JqKTogPyhTY2hlbWFGaWVsZCB8IHN0cmluZykge1xuICBpZiAob2JqIGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICByZXR1cm4gJ0FycmF5JztcbiAgfVxuICBpZiAob2JqLl9fdHlwZSkge1xuICAgIHN3aXRjaCAob2JqLl9fdHlwZSkge1xuICAgICAgY2FzZSAnUG9pbnRlcic6XG4gICAgICAgIGlmIChvYmouY2xhc3NOYW1lKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHR5cGU6ICdQb2ludGVyJyxcbiAgICAgICAgICAgIHRhcmdldENsYXNzOiBvYmouY2xhc3NOYW1lLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdSZWxhdGlvbic6XG4gICAgICAgIGlmIChvYmouY2xhc3NOYW1lKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHR5cGU6ICdSZWxhdGlvbicsXG4gICAgICAgICAgICB0YXJnZXRDbGFzczogb2JqLmNsYXNzTmFtZSxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnRmlsZSc6XG4gICAgICAgIGlmIChvYmoubmFtZSkge1xuICAgICAgICAgIHJldHVybiAnRmlsZSc7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdEYXRlJzpcbiAgICAgICAgaWYgKG9iai5pc28pIHtcbiAgICAgICAgICByZXR1cm4gJ0RhdGUnO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnR2VvUG9pbnQnOlxuICAgICAgICBpZiAob2JqLmxhdGl0dWRlICE9IG51bGwgJiYgb2JqLmxvbmdpdHVkZSAhPSBudWxsKSB7XG4gICAgICAgICAgcmV0dXJuICdHZW9Qb2ludCc7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdCeXRlcyc6XG4gICAgICAgIGlmIChvYmouYmFzZTY0KSB7XG4gICAgICAgICAgcmV0dXJuICdCeXRlcyc7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdQb2x5Z29uJzpcbiAgICAgICAgaWYgKG9iai5jb29yZGluYXRlcykge1xuICAgICAgICAgIHJldHVybiAnUG9seWdvbic7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLklOQ09SUkVDVF9UWVBFLFxuICAgICAgJ1RoaXMgaXMgbm90IGEgdmFsaWQgJyArIG9iai5fX3R5cGVcbiAgICApO1xuICB9XG4gIGlmIChvYmpbJyRuZSddKSB7XG4gICAgcmV0dXJuIGdldE9iamVjdFR5cGUob2JqWyckbmUnXSk7XG4gIH1cbiAgaWYgKG9iai5fX29wKSB7XG4gICAgc3dpdGNoIChvYmouX19vcCkge1xuICAgICAgY2FzZSAnSW5jcmVtZW50JzpcbiAgICAgICAgcmV0dXJuICdOdW1iZXInO1xuICAgICAgY2FzZSAnRGVsZXRlJzpcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICBjYXNlICdBZGQnOlxuICAgICAgY2FzZSAnQWRkVW5pcXVlJzpcbiAgICAgIGNhc2UgJ1JlbW92ZSc6XG4gICAgICAgIHJldHVybiAnQXJyYXknO1xuICAgICAgY2FzZSAnQWRkUmVsYXRpb24nOlxuICAgICAgY2FzZSAnUmVtb3ZlUmVsYXRpb24nOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHR5cGU6ICdSZWxhdGlvbicsXG4gICAgICAgICAgdGFyZ2V0Q2xhc3M6IG9iai5vYmplY3RzWzBdLmNsYXNzTmFtZSxcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgJ0JhdGNoJzpcbiAgICAgICAgcmV0dXJuIGdldE9iamVjdFR5cGUob2JqLm9wc1swXSk7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyAndW5leHBlY3RlZCBvcDogJyArIG9iai5fX29wO1xuICAgIH1cbiAgfVxuICByZXR1cm4gJ09iamVjdCc7XG59XG5cbmV4cG9ydCB7XG4gIGxvYWQsXG4gIGNsYXNzTmFtZUlzVmFsaWQsXG4gIGZpZWxkTmFtZUlzVmFsaWQsXG4gIGludmFsaWRDbGFzc05hbWVNZXNzYWdlLFxuICBidWlsZE1lcmdlZFNjaGVtYU9iamVjdCxcbiAgc3lzdGVtQ2xhc3NlcyxcbiAgZGVmYXVsdENvbHVtbnMsXG4gIGNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEsXG4gIFZvbGF0aWxlQ2xhc3Nlc1NjaGVtYXMsXG4gIFNjaGVtYUNvbnRyb2xsZXIsXG59O1xuIl19