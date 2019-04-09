"use strict";

var _node = require("parse/node");

var _lodash = _interopRequireDefault(require("lodash"));

var _intersect = _interopRequireDefault(require("intersect"));

var _deepcopy = _interopRequireDefault(require("deepcopy"));

var _logger = _interopRequireDefault(require("../logger"));

var SchemaController = _interopRequireWildcard(require("./SchemaController"));

var _StorageAdapter = require("../Adapters/Storage/StorageAdapter");

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = Object.defineProperty && Object.getOwnPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : {}; if (desc.get || desc.set) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; var ownKeys = Object.keys(source); if (typeof Object.getOwnPropertySymbols === 'function') { ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function (sym) { return Object.getOwnPropertyDescriptor(source, sym).enumerable; })); } ownKeys.forEach(function (key) { _defineProperty(target, key, source[key]); }); } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

function _objectWithoutProperties(source, excluded) { if (source == null) return {}; var target = _objectWithoutPropertiesLoose(source, excluded); var key, i; if (Object.getOwnPropertySymbols) { var sourceSymbolKeys = Object.getOwnPropertySymbols(source); for (i = 0; i < sourceSymbolKeys.length; i++) { key = sourceSymbolKeys[i]; if (excluded.indexOf(key) >= 0) continue; if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue; target[key] = source[key]; } } return target; }

function _objectWithoutPropertiesLoose(source, excluded) { if (source == null) return {}; var target = {}; var sourceKeys = Object.keys(source); var key, i; for (i = 0; i < sourceKeys.length; i++) { key = sourceKeys[i]; if (excluded.indexOf(key) >= 0) continue; target[key] = source[key]; } return target; }

function addWriteACL(query, acl) {
  const newQuery = _lodash.default.cloneDeep(query); //Can't be any existing '_wperm' query, we don't allow client queries on that, no need to $and


  newQuery._wperm = {
    $in: [null, ...acl]
  };
  return newQuery;
}

function addReadACL(query, acl) {
  const newQuery = _lodash.default.cloneDeep(query); //Can't be any existing '_rperm' query, we don't allow client queries on that, no need to $and


  newQuery._rperm = {
    $in: [null, '*', ...acl]
  };
  return newQuery;
} // Transforms a REST API formatted ACL object to our two-field mongo format.


const transformObjectACL = (_ref) => {
  let {
    ACL
  } = _ref,
      result = _objectWithoutProperties(_ref, ["ACL"]);

  if (!ACL) {
    return result;
  }

  result._wperm = [];
  result._rperm = [];

  for (const entry in ACL) {
    if (ACL[entry].read) {
      result._rperm.push(entry);
    }

    if (ACL[entry].write) {
      result._wperm.push(entry);
    }
  }

  return result;
};

const specialQuerykeys = ['$and', '$or', '$nor', '_rperm', '_wperm', '_perishable_token', '_email_verify_token', '_email_verify_token_expires_at', '_account_lockout_expires_at', '_failed_login_count'];

const isSpecialQueryKey = key => {
  return specialQuerykeys.indexOf(key) >= 0;
};

const validateQuery = query => {
  if (query.ACL) {
    throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, 'Cannot query on ACL.');
  }

  if (query.$or) {
    if (query.$or instanceof Array) {
      query.$or.forEach(validateQuery);
      /* In MongoDB, $or queries which are not alone at the top level of the
       * query can not make efficient use of indexes due to a long standing
       * bug known as SERVER-13732.
       *
       * This block restructures queries in which $or is not the sole top
       * level element by moving all other top-level predicates inside every
       * subdocument of the $or predicate, allowing MongoDB's query planner
       * to make full use of the most relevant indexes.
       *
       * EG:      {$or: [{a: 1}, {a: 2}], b: 2}
       * Becomes: {$or: [{a: 1, b: 2}, {a: 2, b: 2}]}
       *
       * The only exceptions are $near and $nearSphere operators, which are
       * constrained to only 1 operator per query. As a result, these ops
       * remain at the top level
       *
       * https://jira.mongodb.org/browse/SERVER-13732
       * https://github.com/parse-community/parse-server/issues/3767
       */

      Object.keys(query).forEach(key => {
        const noCollisions = !query.$or.some(subq => subq.hasOwnProperty(key));
        let hasNears = false;

        if (query[key] != null && typeof query[key] == 'object') {
          hasNears = '$near' in query[key] || '$nearSphere' in query[key];
        }

        if (key != '$or' && noCollisions && !hasNears) {
          query.$or.forEach(subquery => {
            subquery[key] = query[key];
          });
          delete query[key];
        }
      });
      query.$or.forEach(validateQuery);
    } else {
      throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, 'Bad $or format - use an array value.');
    }
  }

  if (query.$and) {
    if (query.$and instanceof Array) {
      query.$and.forEach(validateQuery);
    } else {
      throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, 'Bad $and format - use an array value.');
    }
  }

  if (query.$nor) {
    if (query.$nor instanceof Array && query.$nor.length > 0) {
      query.$nor.forEach(validateQuery);
    } else {
      throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, 'Bad $nor format - use an array of at least 1 value.');
    }
  }

  Object.keys(query).forEach(key => {
    if (query && query[key] && query[key].$regex) {
      if (typeof query[key].$options === 'string') {
        if (!query[key].$options.match(/^[imxs]+$/)) {
          throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, `Bad $options value for query: ${query[key].$options}`);
        }
      }
    }

    if (!isSpecialQueryKey(key) && !key.match(/^[a-zA-Z][a-zA-Z0-9_\.]*$/)) {
      throw new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `Invalid key name: ${key}`);
    }
  });
}; // Filters out any data that shouldn't be on this REST-formatted object.


const filterSensitiveData = (isMaster, aclGroup, className, protectedFields, object) => {
  protectedFields && protectedFields.forEach(k => delete object[k]);

  if (className !== '_User') {
    return object;
  }

  object.password = object._hashed_password;
  delete object._hashed_password;
  delete object.sessionToken;

  if (isMaster) {
    return object;
  }

  delete object._email_verify_token;
  delete object._perishable_token;
  delete object._perishable_token_expires_at;
  delete object._tombstone;
  delete object._email_verify_token_expires_at;
  delete object._failed_login_count;
  delete object._account_lockout_expires_at;
  delete object._password_changed_at;
  delete object._password_history;

  if (aclGroup.indexOf(object.objectId) > -1) {
    return object;
  }

  delete object.authData;
  return object;
};

// Runs an update on the database.
// Returns a promise for an object with the new values for field
// modifications that don't know their results ahead of time, like
// 'increment'.
// Options:
//   acl:  a list of strings. If the object to be updated has an ACL,
//         one of the provided strings must provide the caller with
//         write permissions.
const specialKeysForUpdate = ['_hashed_password', '_perishable_token', '_email_verify_token', '_email_verify_token_expires_at', '_account_lockout_expires_at', '_failed_login_count', '_perishable_token_expires_at', '_password_changed_at', '_password_history'];

const isSpecialUpdateKey = key => {
  return specialKeysForUpdate.indexOf(key) >= 0;
};

function expandResultOnKeyPath(object, key, value) {
  if (key.indexOf('.') < 0) {
    object[key] = value[key];
    return object;
  }

  const path = key.split('.');
  const firstKey = path[0];
  const nextPath = path.slice(1).join('.');
  object[firstKey] = expandResultOnKeyPath(object[firstKey] || {}, nextPath, value[firstKey]);
  delete object[key];
  return object;
}

function sanitizeDatabaseResult(originalObject, result) {
  const response = {};

  if (!result) {
    return Promise.resolve(response);
  }

  Object.keys(originalObject).forEach(key => {
    const keyUpdate = originalObject[key]; // determine if that was an op

    if (keyUpdate && typeof keyUpdate === 'object' && keyUpdate.__op && ['Add', 'AddUnique', 'Remove', 'Increment'].indexOf(keyUpdate.__op) > -1) {
      // only valid ops that produce an actionable result
      // the op may have happend on a keypath
      expandResultOnKeyPath(response, key, result);
    }
  });
  return Promise.resolve(response);
}

function joinTableName(className, key) {
  return `_Join:${key}:${className}`;
}

const flattenUpdateOperatorsForCreate = object => {
  for (const key in object) {
    if (object[key] && object[key].__op) {
      switch (object[key].__op) {
        case 'Increment':
          if (typeof object[key].amount !== 'number') {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_JSON, 'objects to add must be an array');
          }

          object[key] = object[key].amount;
          break;

        case 'Add':
          if (!(object[key].objects instanceof Array)) {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_JSON, 'objects to add must be an array');
          }

          object[key] = object[key].objects;
          break;

        case 'AddUnique':
          if (!(object[key].objects instanceof Array)) {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_JSON, 'objects to add must be an array');
          }

          object[key] = object[key].objects;
          break;

        case 'Remove':
          if (!(object[key].objects instanceof Array)) {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_JSON, 'objects to add must be an array');
          }

          object[key] = [];
          break;

        case 'Delete':
          delete object[key];
          break;

        default:
          throw new _node.Parse.Error(_node.Parse.Error.COMMAND_UNAVAILABLE, `The ${object[key].__op} operator is not supported yet.`);
      }
    }
  }
};

const transformAuthData = (className, object, schema) => {
  if (object.authData && className === '_User') {
    Object.keys(object.authData).forEach(provider => {
      const providerData = object.authData[provider];
      const fieldName = `_auth_data_${provider}`;

      if (providerData == null) {
        object[fieldName] = {
          __op: 'Delete'
        };
      } else {
        object[fieldName] = providerData;
        schema.fields[fieldName] = {
          type: 'Object'
        };
      }
    });
    delete object.authData;
  }
}; // Transforms a Database format ACL to a REST API format ACL


const untransformObjectACL = (_ref2) => {
  let {
    _rperm,
    _wperm
  } = _ref2,
      output = _objectWithoutProperties(_ref2, ["_rperm", "_wperm"]);

  if (_rperm || _wperm) {
    output.ACL = {};

    (_rperm || []).forEach(entry => {
      if (!output.ACL[entry]) {
        output.ACL[entry] = {
          read: true
        };
      } else {
        output.ACL[entry]['read'] = true;
      }
    });

    (_wperm || []).forEach(entry => {
      if (!output.ACL[entry]) {
        output.ACL[entry] = {
          write: true
        };
      } else {
        output.ACL[entry]['write'] = true;
      }
    });
  }

  return output;
};
/**
 * When querying, the fieldName may be compound, extract the root fieldName
 *     `temperature.celsius` becomes `temperature`
 * @param {string} fieldName that may be a compound field name
 * @returns {string} the root name of the field
 */


const getRootFieldName = fieldName => {
  return fieldName.split('.')[0];
};

const relationSchema = {
  fields: {
    relatedId: {
      type: 'String'
    },
    owningId: {
      type: 'String'
    }
  }
};

class DatabaseController {
  constructor(adapter, schemaCache) {
    this.adapter = adapter;
    this.schemaCache = schemaCache; // We don't want a mutable this.schema, because then you could have
    // one request that uses different schemas for different parts of
    // it. Instead, use loadSchema to get a schema.

    this.schemaPromise = null;
  }

  collectionExists(className) {
    return this.adapter.classExists(className);
  }

  purgeCollection(className) {
    return this.loadSchema().then(schemaController => schemaController.getOneSchema(className)).then(schema => this.adapter.deleteObjectsByQuery(className, schema, {}));
  }

  validateClassName(className) {
    if (!SchemaController.classNameIsValid(className)) {
      return Promise.reject(new _node.Parse.Error(_node.Parse.Error.INVALID_CLASS_NAME, 'invalid className: ' + className));
    }

    return Promise.resolve();
  } // Returns a promise for a schemaController.


  loadSchema(options = {
    clearCache: false
  }) {
    if (this.schemaPromise != null) {
      return this.schemaPromise;
    }

    this.schemaPromise = SchemaController.load(this.adapter, this.schemaCache, options);
    this.schemaPromise.then(() => delete this.schemaPromise, () => delete this.schemaPromise);
    return this.loadSchema(options);
  } // Returns a promise for the classname that is related to the given
  // classname through the key.
  // TODO: make this not in the DatabaseController interface


  redirectClassNameForKey(className, key) {
    return this.loadSchema().then(schema => {
      var t = schema.getExpectedType(className, key);

      if (t != null && typeof t !== 'string' && t.type === 'Relation') {
        return t.targetClass;
      }

      return className;
    });
  } // Uses the schema to validate the object (REST API format).
  // Returns a promise that resolves to the new schema.
  // This does not update this.schema, because in a situation like a
  // batch request, that could confuse other users of the schema.


  validateObject(className, object, query, {
    acl
  }) {
    let schema;
    const isMaster = acl === undefined;
    var aclGroup = acl || [];
    return this.loadSchema().then(s => {
      schema = s;

      if (isMaster) {
        return Promise.resolve();
      }

      return this.canAddField(schema, className, object, aclGroup);
    }).then(() => {
      return schema.validateObject(className, object, query);
    });
  }

  update(className, query, update, {
    acl,
    many,
    upsert
  } = {}, skipSanitization = false) {
    const originalQuery = query;
    const originalUpdate = update; // Make a copy of the object, so we don't mutate the incoming data.

    update = (0, _deepcopy.default)(update);
    var relationUpdates = [];
    var isMaster = acl === undefined;
    var aclGroup = acl || [];
    return this.loadSchema().then(schemaController => {
      return (isMaster ? Promise.resolve() : schemaController.validatePermission(className, aclGroup, 'update')).then(() => {
        relationUpdates = this.collectRelationUpdates(className, originalQuery.objectId, update);

        if (!isMaster) {
          query = this.addPointerPermissions(schemaController, className, 'update', query, aclGroup);
        }

        if (!query) {
          return Promise.resolve();
        }

        if (acl) {
          query = addWriteACL(query, acl);
        }

        validateQuery(query);
        return schemaController.getOneSchema(className, true).catch(error => {
          // If the schema doesn't exist, pretend it exists with no fields. This behavior
          // will likely need revisiting.
          if (error === undefined) {
            return {
              fields: {}
            };
          }

          throw error;
        }).then(schema => {
          Object.keys(update).forEach(fieldName => {
            if (fieldName.match(/^authData\.([a-zA-Z0-9_]+)\.id$/)) {
              throw new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `Invalid field name for update: ${fieldName}`);
            }

            const rootFieldName = getRootFieldName(fieldName);

            if (!SchemaController.fieldNameIsValid(rootFieldName) && !isSpecialUpdateKey(rootFieldName)) {
              throw new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `Invalid field name for update: ${fieldName}`);
            }
          });

          for (const updateOperation in update) {
            if (update[updateOperation] && typeof update[updateOperation] === 'object' && Object.keys(update[updateOperation]).some(innerKey => innerKey.includes('$') || innerKey.includes('.'))) {
              throw new _node.Parse.Error(_node.Parse.Error.INVALID_NESTED_KEY, "Nested keys should not contain the '$' or '.' characters");
            }
          }

          update = transformObjectACL(update);
          transformAuthData(className, update, schema);

          if (many) {
            return this.adapter.updateObjectsByQuery(className, schema, query, update);
          } else if (upsert) {
            return this.adapter.upsertOneObject(className, schema, query, update);
          } else {
            return this.adapter.findOneAndUpdate(className, schema, query, update);
          }
        });
      }).then(result => {
        if (!result) {
          throw new _node.Parse.Error(_node.Parse.Error.OBJECT_NOT_FOUND, 'Object not found.');
        }

        return this.handleRelationUpdates(className, originalQuery.objectId, update, relationUpdates).then(() => {
          return result;
        });
      }).then(result => {
        if (skipSanitization) {
          return Promise.resolve(result);
        }

        return sanitizeDatabaseResult(originalUpdate, result);
      });
    });
  } // Collect all relation-updating operations from a REST-format update.
  // Returns a list of all relation updates to perform
  // This mutates update.


  collectRelationUpdates(className, objectId, update) {
    var ops = [];
    var deleteMe = [];
    objectId = update.objectId || objectId;

    var process = (op, key) => {
      if (!op) {
        return;
      }

      if (op.__op == 'AddRelation') {
        ops.push({
          key,
          op
        });
        deleteMe.push(key);
      }

      if (op.__op == 'RemoveRelation') {
        ops.push({
          key,
          op
        });
        deleteMe.push(key);
      }

      if (op.__op == 'Batch') {
        for (var x of op.ops) {
          process(x, key);
        }
      }
    };

    for (const key in update) {
      process(update[key], key);
    }

    for (const key of deleteMe) {
      delete update[key];
    }

    return ops;
  } // Processes relation-updating operations from a REST-format update.
  // Returns a promise that resolves when all updates have been performed


  handleRelationUpdates(className, objectId, update, ops) {
    var pending = [];
    objectId = update.objectId || objectId;
    ops.forEach(({
      key,
      op
    }) => {
      if (!op) {
        return;
      }

      if (op.__op == 'AddRelation') {
        for (const object of op.objects) {
          pending.push(this.addRelation(key, className, objectId, object.objectId));
        }
      }

      if (op.__op == 'RemoveRelation') {
        for (const object of op.objects) {
          pending.push(this.removeRelation(key, className, objectId, object.objectId));
        }
      }
    });
    return Promise.all(pending);
  } // Adds a relation.
  // Returns a promise that resolves successfully iff the add was successful.


  addRelation(key, fromClassName, fromId, toId) {
    const doc = {
      relatedId: toId,
      owningId: fromId
    };
    return this.adapter.upsertOneObject(`_Join:${key}:${fromClassName}`, relationSchema, doc, doc);
  } // Removes a relation.
  // Returns a promise that resolves successfully iff the remove was
  // successful.


  removeRelation(key, fromClassName, fromId, toId) {
    var doc = {
      relatedId: toId,
      owningId: fromId
    };
    return this.adapter.deleteObjectsByQuery(`_Join:${key}:${fromClassName}`, relationSchema, doc).catch(error => {
      // We don't care if they try to delete a non-existent relation.
      if (error.code == _node.Parse.Error.OBJECT_NOT_FOUND) {
        return;
      }

      throw error;
    });
  } // Removes objects matches this query from the database.
  // Returns a promise that resolves successfully iff the object was
  // deleted.
  // Options:
  //   acl:  a list of strings. If the object to be updated has an ACL,
  //         one of the provided strings must provide the caller with
  //         write permissions.


  destroy(className, query, {
    acl
  } = {}) {
    const isMaster = acl === undefined;
    const aclGroup = acl || [];
    return this.loadSchema().then(schemaController => {
      return (isMaster ? Promise.resolve() : schemaController.validatePermission(className, aclGroup, 'delete')).then(() => {
        if (!isMaster) {
          query = this.addPointerPermissions(schemaController, className, 'delete', query, aclGroup);

          if (!query) {
            throw new _node.Parse.Error(_node.Parse.Error.OBJECT_NOT_FOUND, 'Object not found.');
          }
        } // delete by query


        if (acl) {
          query = addWriteACL(query, acl);
        }

        validateQuery(query);
        return schemaController.getOneSchema(className).catch(error => {
          // If the schema doesn't exist, pretend it exists with no fields. This behavior
          // will likely need revisiting.
          if (error === undefined) {
            return {
              fields: {}
            };
          }

          throw error;
        }).then(parseFormatSchema => this.adapter.deleteObjectsByQuery(className, parseFormatSchema, query)).catch(error => {
          // When deleting sessions while changing passwords, don't throw an error if they don't have any sessions.
          if (className === '_Session' && error.code === _node.Parse.Error.OBJECT_NOT_FOUND) {
            return Promise.resolve({});
          }

          throw error;
        });
      });
    });
  } // Inserts an object into the database.
  // Returns a promise that resolves successfully iff the object saved.


  create(className, object, {
    acl
  } = {}) {
    // Make a copy of the object, so we don't mutate the incoming data.
    const originalObject = object;
    object = transformObjectACL(object);
    object.createdAt = {
      iso: object.createdAt,
      __type: 'Date'
    };
    object.updatedAt = {
      iso: object.updatedAt,
      __type: 'Date'
    };
    var isMaster = acl === undefined;
    var aclGroup = acl || [];
    const relationUpdates = this.collectRelationUpdates(className, null, object);
    return this.validateClassName(className).then(() => this.loadSchema()).then(schemaController => {
      return (isMaster ? Promise.resolve() : schemaController.validatePermission(className, aclGroup, 'create')).then(() => schemaController.enforceClassExists(className)).then(() => schemaController.reloadData()).then(() => schemaController.getOneSchema(className, true)).then(schema => {
        transformAuthData(className, object, schema);
        flattenUpdateOperatorsForCreate(object);
        return this.adapter.createObject(className, SchemaController.convertSchemaToAdapterSchema(schema), object);
      }).then(result => {
        return this.handleRelationUpdates(className, object.objectId, object, relationUpdates).then(() => {
          return sanitizeDatabaseResult(originalObject, result.ops[0]);
        });
      });
    });
  }

  canAddField(schema, className, object, aclGroup) {
    const classSchema = schema.schemaData[className];

    if (!classSchema) {
      return Promise.resolve();
    }

    const fields = Object.keys(object);
    const schemaFields = Object.keys(classSchema.fields);
    const newKeys = fields.filter(field => {
      // Skip fields that are unset
      if (object[field] && object[field].__op && object[field].__op === 'Delete') {
        return false;
      }

      return schemaFields.indexOf(field) < 0;
    });

    if (newKeys.length > 0) {
      return schema.validatePermission(className, aclGroup, 'addField');
    }

    return Promise.resolve();
  } // Won't delete collections in the system namespace

  /**
   * Delete all classes and clears the schema cache
   *
   * @param {boolean} fast set to true if it's ok to just delete rows and not indexes
   * @returns {Promise<void>} when the deletions completes
   */


  deleteEverything(fast = false) {
    this.schemaPromise = null;
    return Promise.all([this.adapter.deleteAllClasses(fast), this.schemaCache.clear()]);
  } // Returns a promise for a list of related ids given an owning id.
  // className here is the owning className.


  relatedIds(className, key, owningId, queryOptions) {
    const {
      skip,
      limit,
      sort
    } = queryOptions;
    const findOptions = {};

    if (sort && sort.createdAt && this.adapter.canSortOnJoinTables) {
      findOptions.sort = {
        _id: sort.createdAt
      };
      findOptions.limit = limit;
      findOptions.skip = skip;
      queryOptions.skip = 0;
    }

    return this.adapter.find(joinTableName(className, key), relationSchema, {
      owningId
    }, findOptions).then(results => results.map(result => result.relatedId));
  } // Returns a promise for a list of owning ids given some related ids.
  // className here is the owning className.


  owningIds(className, key, relatedIds) {
    return this.adapter.find(joinTableName(className, key), relationSchema, {
      relatedId: {
        $in: relatedIds
      }
    }, {}).then(results => results.map(result => result.owningId));
  } // Modifies query so that it no longer has $in on relation fields, or
  // equal-to-pointer constraints on relation fields.
  // Returns a promise that resolves when query is mutated


  reduceInRelation(className, query, schema) {
    // Search for an in-relation or equal-to-relation
    // Make it sequential for now, not sure of paralleization side effects
    if (query['$or']) {
      const ors = query['$or'];
      return Promise.all(ors.map((aQuery, index) => {
        return this.reduceInRelation(className, aQuery, schema).then(aQuery => {
          query['$or'][index] = aQuery;
        });
      })).then(() => {
        return Promise.resolve(query);
      });
    }

    const promises = Object.keys(query).map(key => {
      const t = schema.getExpectedType(className, key);

      if (!t || t.type !== 'Relation') {
        return Promise.resolve(query);
      }

      let queries = null;

      if (query[key] && (query[key]['$in'] || query[key]['$ne'] || query[key]['$nin'] || query[key].__type == 'Pointer')) {
        // Build the list of queries
        queries = Object.keys(query[key]).map(constraintKey => {
          let relatedIds;
          let isNegation = false;

          if (constraintKey === 'objectId') {
            relatedIds = [query[key].objectId];
          } else if (constraintKey == '$in') {
            relatedIds = query[key]['$in'].map(r => r.objectId);
          } else if (constraintKey == '$nin') {
            isNegation = true;
            relatedIds = query[key]['$nin'].map(r => r.objectId);
          } else if (constraintKey == '$ne') {
            isNegation = true;
            relatedIds = [query[key]['$ne'].objectId];
          } else {
            return;
          }

          return {
            isNegation,
            relatedIds
          };
        });
      } else {
        queries = [{
          isNegation: false,
          relatedIds: []
        }];
      } // remove the current queryKey as we don,t need it anymore


      delete query[key]; // execute each query independently to build the list of
      // $in / $nin

      const promises = queries.map(q => {
        if (!q) {
          return Promise.resolve();
        }

        return this.owningIds(className, key, q.relatedIds).then(ids => {
          if (q.isNegation) {
            this.addNotInObjectIdsIds(ids, query);
          } else {
            this.addInObjectIdsIds(ids, query);
          }

          return Promise.resolve();
        });
      });
      return Promise.all(promises).then(() => {
        return Promise.resolve();
      });
    });
    return Promise.all(promises).then(() => {
      return Promise.resolve(query);
    });
  } // Modifies query so that it no longer has $relatedTo
  // Returns a promise that resolves when query is mutated


  reduceRelationKeys(className, query, queryOptions) {
    if (query['$or']) {
      return Promise.all(query['$or'].map(aQuery => {
        return this.reduceRelationKeys(className, aQuery, queryOptions);
      }));
    }

    var relatedTo = query['$relatedTo'];

    if (relatedTo) {
      return this.relatedIds(relatedTo.object.className, relatedTo.key, relatedTo.object.objectId, queryOptions).then(ids => {
        delete query['$relatedTo'];
        this.addInObjectIdsIds(ids, query);
        return this.reduceRelationKeys(className, query, queryOptions);
      }).then(() => {});
    }
  }

  addInObjectIdsIds(ids = null, query) {
    const idsFromString = typeof query.objectId === 'string' ? [query.objectId] : null;
    const idsFromEq = query.objectId && query.objectId['$eq'] ? [query.objectId['$eq']] : null;
    const idsFromIn = query.objectId && query.objectId['$in'] ? query.objectId['$in'] : null; // -disable-next

    const allIds = [idsFromString, idsFromEq, idsFromIn, ids].filter(list => list !== null);
    const totalLength = allIds.reduce((memo, list) => memo + list.length, 0);
    let idsIntersection = [];

    if (totalLength > 125) {
      idsIntersection = _intersect.default.big(allIds);
    } else {
      idsIntersection = (0, _intersect.default)(allIds);
    } // Need to make sure we don't clobber existing shorthand $eq constraints on objectId.


    if (!('objectId' in query)) {
      query.objectId = {
        $in: undefined
      };
    } else if (typeof query.objectId === 'string') {
      query.objectId = {
        $in: undefined,
        $eq: query.objectId
      };
    }

    query.objectId['$in'] = idsIntersection;
    return query;
  }

  addNotInObjectIdsIds(ids = [], query) {
    const idsFromNin = query.objectId && query.objectId['$nin'] ? query.objectId['$nin'] : [];
    let allIds = [...idsFromNin, ...ids].filter(list => list !== null); // make a set and spread to remove duplicates

    allIds = [...new Set(allIds)]; // Need to make sure we don't clobber existing shorthand $eq constraints on objectId.

    if (!('objectId' in query)) {
      query.objectId = {
        $nin: undefined
      };
    } else if (typeof query.objectId === 'string') {
      query.objectId = {
        $nin: undefined,
        $eq: query.objectId
      };
    }

    query.objectId['$nin'] = allIds;
    return query;
  } // Runs a query on the database.
  // Returns a promise that resolves to a list of items.
  // Options:
  //   skip    number of results to skip.
  //   limit   limit to this number of results.
  //   sort    an object where keys are the fields to sort by.
  //           the value is +1 for ascending, -1 for descending.
  //   count   run a count instead of returning results.
  //   acl     restrict this operation with an ACL for the provided array
  //           of user objectIds and roles. acl: null means no user.
  //           when this field is not present, don't do anything regarding ACLs.
  // TODO: make userIds not needed here. The db adapter shouldn't know
  // anything about users, ideally. Then, improve the format of the ACL
  // arg to work like the others.


  find(className, query, {
    skip,
    limit,
    acl,
    sort = {},
    count,
    keys,
    op,
    distinct,
    pipeline,
    readPreference
  } = {}, auth = {}) {
    const isMaster = acl === undefined;
    const aclGroup = acl || [];
    op = op || (typeof query.objectId == 'string' && Object.keys(query).length === 1 ? 'get' : 'find'); // Count operation if counting

    op = count === true ? 'count' : op;
    let classExists = true;
    return this.loadSchema().then(schemaController => {
      //Allow volatile classes if querying with Master (for _PushStatus)
      //TODO: Move volatile classes concept into mongo adapter, postgres adapter shouldn't care
      //that api.parse.com breaks when _PushStatus exists in mongo.
      return schemaController.getOneSchema(className, isMaster).catch(error => {
        // Behavior for non-existent classes is kinda weird on Parse.com. Probably doesn't matter too much.
        // For now, pretend the class exists but has no objects,
        if (error === undefined) {
          classExists = false;
          return {
            fields: {}
          };
        }

        throw error;
      }).then(schema => {
        // Parse.com treats queries on _created_at and _updated_at as if they were queries on createdAt and updatedAt,
        // so duplicate that behavior here. If both are specified, the correct behavior to match Parse.com is to
        // use the one that appears first in the sort list.
        if (sort._created_at) {
          sort.createdAt = sort._created_at;
          delete sort._created_at;
        }

        if (sort._updated_at) {
          sort.updatedAt = sort._updated_at;
          delete sort._updated_at;
        }

        const queryOptions = {
          skip,
          limit,
          sort,
          keys,
          readPreference
        };
        Object.keys(sort).forEach(fieldName => {
          if (fieldName.match(/^authData\.([a-zA-Z0-9_]+)\.id$/)) {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `Cannot sort by ${fieldName}`);
          }

          const rootFieldName = getRootFieldName(fieldName);

          if (!SchemaController.fieldNameIsValid(rootFieldName)) {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `Invalid field name: ${fieldName}.`);
          }
        });
        return (isMaster ? Promise.resolve() : schemaController.validatePermission(className, aclGroup, op)).then(() => this.reduceRelationKeys(className, query, queryOptions)).then(() => this.reduceInRelation(className, query, schemaController)).then(() => {
          let protectedFields;

          if (!isMaster) {
            query = this.addPointerPermissions(schemaController, className, op, query, aclGroup); // ProtectedFields is generated before executing the query so we
            // can optimize the query using Mongo Projection at a later stage.

            protectedFields = this.addProtectedFields(schemaController, className, query, aclGroup, auth);
          }

          if (!query) {
            if (op === 'get') {
              throw new _node.Parse.Error(_node.Parse.Error.OBJECT_NOT_FOUND, 'Object not found.');
            } else {
              return [];
            }
          }

          if (!isMaster) {
            if (op === 'update' || op === 'delete') {
              query = addWriteACL(query, aclGroup);
            } else {
              query = addReadACL(query, aclGroup);
            }
          }

          validateQuery(query);

          if (count) {
            if (!classExists) {
              return 0;
            } else {
              return this.adapter.count(className, schema, query, readPreference);
            }
          } else if (distinct) {
            if (!classExists) {
              return [];
            } else {
              return this.adapter.distinct(className, schema, query, distinct);
            }
          } else if (pipeline) {
            if (!classExists) {
              return [];
            } else {
              return this.adapter.aggregate(className, schema, pipeline, readPreference);
            }
          } else {
            return this.adapter.find(className, schema, query, queryOptions).then(objects => objects.map(object => {
              object = untransformObjectACL(object);
              return filterSensitiveData(isMaster, aclGroup, className, protectedFields, object);
            })).catch(error => {
              throw new _node.Parse.Error(_node.Parse.Error.INTERNAL_SERVER_ERROR, error);
            });
          }
        });
      });
    });
  }

  deleteSchema(className) {
    return this.loadSchema({
      clearCache: true
    }).then(schemaController => schemaController.getOneSchema(className, true)).catch(error => {
      if (error === undefined) {
        return {
          fields: {}
        };
      } else {
        throw error;
      }
    }).then(schema => {
      return this.collectionExists(className).then(() => this.adapter.count(className, {
        fields: {}
      })).then(count => {
        if (count > 0) {
          throw new _node.Parse.Error(255, `Class ${className} is not empty, contains ${count} objects, cannot drop schema.`);
        }

        return this.adapter.deleteClass(className);
      }).then(wasParseCollection => {
        if (wasParseCollection) {
          const relationFieldNames = Object.keys(schema.fields).filter(fieldName => schema.fields[fieldName].type === 'Relation');
          return Promise.all(relationFieldNames.map(name => this.adapter.deleteClass(joinTableName(className, name)))).then(() => {
            return;
          });
        } else {
          return Promise.resolve();
        }
      });
    });
  }

  addPointerPermissions(schema, className, operation, query, aclGroup = []) {
    // Check if class has public permission for operation
    // If the BaseCLP pass, let go through
    if (schema.testPermissionsForClassName(className, aclGroup, operation)) {
      return query;
    }

    const perms = schema.getClassLevelPermissions(className);
    const field = ['get', 'find'].indexOf(operation) > -1 ? 'readUserFields' : 'writeUserFields';
    const userACL = aclGroup.filter(acl => {
      return acl.indexOf('role:') != 0 && acl != '*';
    }); // the ACL should have exactly 1 user

    if (perms && perms[field] && perms[field].length > 0) {
      // No user set return undefined
      // If the length is > 1, that means we didn't de-dupe users correctly
      if (userACL.length != 1) {
        return;
      }

      const userId = userACL[0];
      const userPointer = {
        __type: 'Pointer',
        className: '_User',
        objectId: userId
      };
      const permFields = perms[field];
      const ors = permFields.map(key => {
        const q = {
          [key]: userPointer
        }; // if we already have a constraint on the key, use the $and

        if (query.hasOwnProperty(key)) {
          return {
            $and: [q, query]
          };
        } // otherwise just add the constaint


        return Object.assign({}, query, {
          [`${key}`]: userPointer
        });
      });

      if (ors.length > 1) {
        return {
          $or: ors
        };
      }

      return ors[0];
    } else {
      return query;
    }
  }

  addProtectedFields(schema, className, query = {}, aclGroup = [], auth = {}) {
    const perms = schema.getClassLevelPermissions(className);
    if (!perms) return null;
    const protectedFields = perms.protectedFields;
    if (!protectedFields) return null;
    if (aclGroup.indexOf(query.objectId) > -1) return null;
    if (Object.keys(query).length === 0 && auth && auth.user && aclGroup.indexOf(auth.user.id) > -1) return null;
    let protectedKeys = Object.values(protectedFields).reduce((acc, val) => acc.concat(val), []); //.flat();

    [...(auth.userRoles || [])].forEach(role => {
      const fields = protectedFields[role];

      if (fields) {
        protectedKeys = protectedKeys.filter(v => fields.includes(v));
      }
    });
    return protectedKeys;
  } // TODO: create indexes on first creation of a _User object. Otherwise it's impossible to
  // have a Parse app without it having a _User collection.


  performInitialization() {
    const requiredUserFields = {
      fields: _objectSpread({}, SchemaController.defaultColumns._Default, SchemaController.defaultColumns._User)
    };
    const requiredRoleFields = {
      fields: _objectSpread({}, SchemaController.defaultColumns._Default, SchemaController.defaultColumns._Role)
    };
    const userClassPromise = this.loadSchema().then(schema => schema.enforceClassExists('_User'));
    const roleClassPromise = this.loadSchema().then(schema => schema.enforceClassExists('_Role'));
    const usernameUniqueness = userClassPromise.then(() => this.adapter.ensureUniqueness('_User', requiredUserFields, ['username'])).catch(error => {
      _logger.default.warn('Unable to ensure uniqueness for usernames: ', error);

      throw error;
    });
    const emailUniqueness = userClassPromise.then(() => this.adapter.ensureUniqueness('_User', requiredUserFields, ['email'])).catch(error => {
      _logger.default.warn('Unable to ensure uniqueness for user email addresses: ', error);

      throw error;
    });
    const roleUniqueness = roleClassPromise.then(() => this.adapter.ensureUniqueness('_Role', requiredRoleFields, ['name'])).catch(error => {
      _logger.default.warn('Unable to ensure uniqueness for role name: ', error);

      throw error;
    });
    const indexPromise = this.adapter.updateSchemaWithIndexes(); // Create tables for volatile classes

    const adapterInit = this.adapter.performInitialization({
      VolatileClassesSchemas: SchemaController.VolatileClassesSchemas
    });
    return Promise.all([usernameUniqueness, emailUniqueness, roleUniqueness, adapterInit, indexPromise]);
  }

}

module.exports = DatabaseController; // Expose validateQuery for tests

module.exports._validateQuery = validateQuery;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9EYXRhYmFzZUNvbnRyb2xsZXIuanMiXSwibmFtZXMiOlsiYWRkV3JpdGVBQ0wiLCJxdWVyeSIsImFjbCIsIm5ld1F1ZXJ5IiwiXyIsImNsb25lRGVlcCIsIl93cGVybSIsIiRpbiIsImFkZFJlYWRBQ0wiLCJfcnBlcm0iLCJ0cmFuc2Zvcm1PYmplY3RBQ0wiLCJBQ0wiLCJyZXN1bHQiLCJlbnRyeSIsInJlYWQiLCJwdXNoIiwid3JpdGUiLCJzcGVjaWFsUXVlcnlrZXlzIiwiaXNTcGVjaWFsUXVlcnlLZXkiLCJrZXkiLCJpbmRleE9mIiwidmFsaWRhdGVRdWVyeSIsIlBhcnNlIiwiRXJyb3IiLCJJTlZBTElEX1FVRVJZIiwiJG9yIiwiQXJyYXkiLCJmb3JFYWNoIiwiT2JqZWN0Iiwia2V5cyIsIm5vQ29sbGlzaW9ucyIsInNvbWUiLCJzdWJxIiwiaGFzT3duUHJvcGVydHkiLCJoYXNOZWFycyIsInN1YnF1ZXJ5IiwiJGFuZCIsIiRub3IiLCJsZW5ndGgiLCIkcmVnZXgiLCIkb3B0aW9ucyIsIm1hdGNoIiwiSU5WQUxJRF9LRVlfTkFNRSIsImZpbHRlclNlbnNpdGl2ZURhdGEiLCJpc01hc3RlciIsImFjbEdyb3VwIiwiY2xhc3NOYW1lIiwicHJvdGVjdGVkRmllbGRzIiwib2JqZWN0IiwiayIsInBhc3N3b3JkIiwiX2hhc2hlZF9wYXNzd29yZCIsInNlc3Npb25Ub2tlbiIsIl9lbWFpbF92ZXJpZnlfdG9rZW4iLCJfcGVyaXNoYWJsZV90b2tlbiIsIl9wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQiLCJfdG9tYnN0b25lIiwiX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0IiwiX2ZhaWxlZF9sb2dpbl9jb3VudCIsIl9hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCIsIl9wYXNzd29yZF9jaGFuZ2VkX2F0IiwiX3Bhc3N3b3JkX2hpc3RvcnkiLCJvYmplY3RJZCIsImF1dGhEYXRhIiwic3BlY2lhbEtleXNGb3JVcGRhdGUiLCJpc1NwZWNpYWxVcGRhdGVLZXkiLCJleHBhbmRSZXN1bHRPbktleVBhdGgiLCJ2YWx1ZSIsInBhdGgiLCJzcGxpdCIsImZpcnN0S2V5IiwibmV4dFBhdGgiLCJzbGljZSIsImpvaW4iLCJzYW5pdGl6ZURhdGFiYXNlUmVzdWx0Iiwib3JpZ2luYWxPYmplY3QiLCJyZXNwb25zZSIsIlByb21pc2UiLCJyZXNvbHZlIiwia2V5VXBkYXRlIiwiX19vcCIsImpvaW5UYWJsZU5hbWUiLCJmbGF0dGVuVXBkYXRlT3BlcmF0b3JzRm9yQ3JlYXRlIiwiYW1vdW50IiwiSU5WQUxJRF9KU09OIiwib2JqZWN0cyIsIkNPTU1BTkRfVU5BVkFJTEFCTEUiLCJ0cmFuc2Zvcm1BdXRoRGF0YSIsInNjaGVtYSIsInByb3ZpZGVyIiwicHJvdmlkZXJEYXRhIiwiZmllbGROYW1lIiwiZmllbGRzIiwidHlwZSIsInVudHJhbnNmb3JtT2JqZWN0QUNMIiwib3V0cHV0IiwiZ2V0Um9vdEZpZWxkTmFtZSIsInJlbGF0aW9uU2NoZW1hIiwicmVsYXRlZElkIiwib3duaW5nSWQiLCJEYXRhYmFzZUNvbnRyb2xsZXIiLCJjb25zdHJ1Y3RvciIsImFkYXB0ZXIiLCJzY2hlbWFDYWNoZSIsInNjaGVtYVByb21pc2UiLCJjb2xsZWN0aW9uRXhpc3RzIiwiY2xhc3NFeGlzdHMiLCJwdXJnZUNvbGxlY3Rpb24iLCJsb2FkU2NoZW1hIiwidGhlbiIsInNjaGVtYUNvbnRyb2xsZXIiLCJnZXRPbmVTY2hlbWEiLCJkZWxldGVPYmplY3RzQnlRdWVyeSIsInZhbGlkYXRlQ2xhc3NOYW1lIiwiU2NoZW1hQ29udHJvbGxlciIsImNsYXNzTmFtZUlzVmFsaWQiLCJyZWplY3QiLCJJTlZBTElEX0NMQVNTX05BTUUiLCJvcHRpb25zIiwiY2xlYXJDYWNoZSIsImxvYWQiLCJyZWRpcmVjdENsYXNzTmFtZUZvcktleSIsInQiLCJnZXRFeHBlY3RlZFR5cGUiLCJ0YXJnZXRDbGFzcyIsInZhbGlkYXRlT2JqZWN0IiwidW5kZWZpbmVkIiwicyIsImNhbkFkZEZpZWxkIiwidXBkYXRlIiwibWFueSIsInVwc2VydCIsInNraXBTYW5pdGl6YXRpb24iLCJvcmlnaW5hbFF1ZXJ5Iiwib3JpZ2luYWxVcGRhdGUiLCJyZWxhdGlvblVwZGF0ZXMiLCJ2YWxpZGF0ZVBlcm1pc3Npb24iLCJjb2xsZWN0UmVsYXRpb25VcGRhdGVzIiwiYWRkUG9pbnRlclBlcm1pc3Npb25zIiwiY2F0Y2giLCJlcnJvciIsInJvb3RGaWVsZE5hbWUiLCJmaWVsZE5hbWVJc1ZhbGlkIiwidXBkYXRlT3BlcmF0aW9uIiwiaW5uZXJLZXkiLCJpbmNsdWRlcyIsIklOVkFMSURfTkVTVEVEX0tFWSIsInVwZGF0ZU9iamVjdHNCeVF1ZXJ5IiwidXBzZXJ0T25lT2JqZWN0IiwiZmluZE9uZUFuZFVwZGF0ZSIsIk9CSkVDVF9OT1RfRk9VTkQiLCJoYW5kbGVSZWxhdGlvblVwZGF0ZXMiLCJvcHMiLCJkZWxldGVNZSIsInByb2Nlc3MiLCJvcCIsIngiLCJwZW5kaW5nIiwiYWRkUmVsYXRpb24iLCJyZW1vdmVSZWxhdGlvbiIsImFsbCIsImZyb21DbGFzc05hbWUiLCJmcm9tSWQiLCJ0b0lkIiwiZG9jIiwiY29kZSIsImRlc3Ryb3kiLCJwYXJzZUZvcm1hdFNjaGVtYSIsImNyZWF0ZSIsImNyZWF0ZWRBdCIsImlzbyIsIl9fdHlwZSIsInVwZGF0ZWRBdCIsImVuZm9yY2VDbGFzc0V4aXN0cyIsInJlbG9hZERhdGEiLCJjcmVhdGVPYmplY3QiLCJjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hIiwiY2xhc3NTY2hlbWEiLCJzY2hlbWFEYXRhIiwic2NoZW1hRmllbGRzIiwibmV3S2V5cyIsImZpbHRlciIsImZpZWxkIiwiZGVsZXRlRXZlcnl0aGluZyIsImZhc3QiLCJkZWxldGVBbGxDbGFzc2VzIiwiY2xlYXIiLCJyZWxhdGVkSWRzIiwicXVlcnlPcHRpb25zIiwic2tpcCIsImxpbWl0Iiwic29ydCIsImZpbmRPcHRpb25zIiwiY2FuU29ydE9uSm9pblRhYmxlcyIsIl9pZCIsImZpbmQiLCJyZXN1bHRzIiwibWFwIiwib3duaW5nSWRzIiwicmVkdWNlSW5SZWxhdGlvbiIsIm9ycyIsImFRdWVyeSIsImluZGV4IiwicHJvbWlzZXMiLCJxdWVyaWVzIiwiY29uc3RyYWludEtleSIsImlzTmVnYXRpb24iLCJyIiwicSIsImlkcyIsImFkZE5vdEluT2JqZWN0SWRzSWRzIiwiYWRkSW5PYmplY3RJZHNJZHMiLCJyZWR1Y2VSZWxhdGlvbktleXMiLCJyZWxhdGVkVG8iLCJpZHNGcm9tU3RyaW5nIiwiaWRzRnJvbUVxIiwiaWRzRnJvbUluIiwiYWxsSWRzIiwibGlzdCIsInRvdGFsTGVuZ3RoIiwicmVkdWNlIiwibWVtbyIsImlkc0ludGVyc2VjdGlvbiIsImludGVyc2VjdCIsImJpZyIsIiRlcSIsImlkc0Zyb21OaW4iLCJTZXQiLCIkbmluIiwiY291bnQiLCJkaXN0aW5jdCIsInBpcGVsaW5lIiwicmVhZFByZWZlcmVuY2UiLCJhdXRoIiwiX2NyZWF0ZWRfYXQiLCJfdXBkYXRlZF9hdCIsImFkZFByb3RlY3RlZEZpZWxkcyIsImFnZ3JlZ2F0ZSIsIklOVEVSTkFMX1NFUlZFUl9FUlJPUiIsImRlbGV0ZVNjaGVtYSIsImRlbGV0ZUNsYXNzIiwid2FzUGFyc2VDb2xsZWN0aW9uIiwicmVsYXRpb25GaWVsZE5hbWVzIiwibmFtZSIsIm9wZXJhdGlvbiIsInRlc3RQZXJtaXNzaW9uc0ZvckNsYXNzTmFtZSIsInBlcm1zIiwiZ2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zIiwidXNlckFDTCIsInVzZXJJZCIsInVzZXJQb2ludGVyIiwicGVybUZpZWxkcyIsImFzc2lnbiIsInVzZXIiLCJpZCIsInByb3RlY3RlZEtleXMiLCJ2YWx1ZXMiLCJhY2MiLCJ2YWwiLCJjb25jYXQiLCJ1c2VyUm9sZXMiLCJyb2xlIiwidiIsInBlcmZvcm1Jbml0aWFsaXphdGlvbiIsInJlcXVpcmVkVXNlckZpZWxkcyIsImRlZmF1bHRDb2x1bW5zIiwiX0RlZmF1bHQiLCJfVXNlciIsInJlcXVpcmVkUm9sZUZpZWxkcyIsIl9Sb2xlIiwidXNlckNsYXNzUHJvbWlzZSIsInJvbGVDbGFzc1Byb21pc2UiLCJ1c2VybmFtZVVuaXF1ZW5lc3MiLCJlbnN1cmVVbmlxdWVuZXNzIiwibG9nZ2VyIiwid2FybiIsImVtYWlsVW5pcXVlbmVzcyIsInJvbGVVbmlxdWVuZXNzIiwiaW5kZXhQcm9taXNlIiwidXBkYXRlU2NoZW1hV2l0aEluZGV4ZXMiLCJhZGFwdGVySW5pdCIsIlZvbGF0aWxlQ2xhc3Nlc1NjaGVtYXMiLCJtb2R1bGUiLCJleHBvcnRzIiwiX3ZhbGlkYXRlUXVlcnkiXSwibWFwcGluZ3MiOiI7O0FBS0E7O0FBRUE7O0FBRUE7O0FBRUE7O0FBQ0E7O0FBQ0E7O0FBQ0E7Ozs7Ozs7Ozs7Ozs7O0FBTUEsU0FBU0EsV0FBVCxDQUFxQkMsS0FBckIsRUFBNEJDLEdBQTVCLEVBQWlDO0FBQy9CLFFBQU1DLFFBQVEsR0FBR0MsZ0JBQUVDLFNBQUYsQ0FBWUosS0FBWixDQUFqQixDQUQrQixDQUUvQjs7O0FBQ0FFLEVBQUFBLFFBQVEsQ0FBQ0csTUFBVCxHQUFrQjtBQUFFQyxJQUFBQSxHQUFHLEVBQUUsQ0FBQyxJQUFELEVBQU8sR0FBR0wsR0FBVjtBQUFQLEdBQWxCO0FBQ0EsU0FBT0MsUUFBUDtBQUNEOztBQUVELFNBQVNLLFVBQVQsQ0FBb0JQLEtBQXBCLEVBQTJCQyxHQUEzQixFQUFnQztBQUM5QixRQUFNQyxRQUFRLEdBQUdDLGdCQUFFQyxTQUFGLENBQVlKLEtBQVosQ0FBakIsQ0FEOEIsQ0FFOUI7OztBQUNBRSxFQUFBQSxRQUFRLENBQUNNLE1BQVQsR0FBa0I7QUFBRUYsSUFBQUEsR0FBRyxFQUFFLENBQUMsSUFBRCxFQUFPLEdBQVAsRUFBWSxHQUFHTCxHQUFmO0FBQVAsR0FBbEI7QUFDQSxTQUFPQyxRQUFQO0FBQ0QsQyxDQUVEOzs7QUFDQSxNQUFNTyxrQkFBa0IsR0FBRyxVQUF3QjtBQUFBLE1BQXZCO0FBQUVDLElBQUFBO0FBQUYsR0FBdUI7QUFBQSxNQUFiQyxNQUFhOztBQUNqRCxNQUFJLENBQUNELEdBQUws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Ly8gQGZsb3dcbi8vIEEgZGF0YWJhc2UgYWRhcHRlciB0aGF0IHdvcmtzIHdpdGggZGF0YSBleHBvcnRlZCBmcm9tIHRoZSBob3N0ZWRcbi8vIFBhcnNlIGRhdGFiYXNlLlxuXG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmltcG9ydCB7IFBhcnNlIH0gZnJvbSAncGFyc2Uvbm9kZSc7XG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmltcG9ydCBfIGZyb20gJ2xvZGFzaCc7XG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmltcG9ydCBpbnRlcnNlY3QgZnJvbSAnaW50ZXJzZWN0Jztcbi8vIEBmbG93LWRpc2FibGUtbmV4dFxuaW1wb3J0IGRlZXBjb3B5IGZyb20gJ2RlZXBjb3B5JztcbmltcG9ydCBsb2dnZXIgZnJvbSAnLi4vbG9nZ2VyJztcbmltcG9ydCAqIGFzIFNjaGVtYUNvbnRyb2xsZXIgZnJvbSAnLi9TY2hlbWFDb250cm9sbGVyJztcbmltcG9ydCB7IFN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnLi4vQWRhcHRlcnMvU3RvcmFnZS9TdG9yYWdlQWRhcHRlcic7XG5pbXBvcnQgdHlwZSB7XG4gIFF1ZXJ5T3B0aW9ucyxcbiAgRnVsbFF1ZXJ5T3B0aW9ucyxcbn0gZnJvbSAnLi4vQWRhcHRlcnMvU3RvcmFnZS9TdG9yYWdlQWRhcHRlcic7XG5cbmZ1bmN0aW9uIGFkZFdyaXRlQUNMKHF1ZXJ5LCBhY2wpIHtcbiAgY29uc3QgbmV3UXVlcnkgPSBfLmNsb25lRGVlcChxdWVyeSk7XG4gIC8vQ2FuJ3QgYmUgYW55IGV4aXN0aW5nICdfd3Blcm0nIHF1ZXJ5LCB3ZSBkb24ndCBhbGxvdyBjbGllbnQgcXVlcmllcyBvbiB0aGF0LCBubyBuZWVkIHRvICRhbmRcbiAgbmV3UXVlcnkuX3dwZXJtID0geyAkaW46IFtudWxsLCAuLi5hY2xdIH07XG4gIHJldHVybiBuZXdRdWVyeTtcbn1cblxuZnVuY3Rpb24gYWRkUmVhZEFDTChxdWVyeSwgYWNsKSB7XG4gIGNvbnN0IG5ld1F1ZXJ5ID0gXy5jbG9uZURlZXAocXVlcnkpO1xuICAvL0Nhbid0IGJlIGFueSBleGlzdGluZyAnX3JwZXJtJyBxdWVyeSwgd2UgZG9uJ3QgYWxsb3cgY2xpZW50IHF1ZXJpZXMgb24gdGhhdCwgbm8gbmVlZCB0byAkYW5kXG4gIG5ld1F1ZXJ5Ll9ycGVybSA9IHsgJGluOiBbbnVsbCwgJyonLCAuLi5hY2xdIH07XG4gIHJldHVybiBuZXdRdWVyeTtcbn1cblxuLy8gVHJhbnNmb3JtcyBhIFJFU1QgQVBJIGZvcm1hdHRlZCBBQ0wgb2JqZWN0IHRvIG91ciB0d28tZmllbGQgbW9uZ28gZm9ybWF0LlxuY29uc3QgdHJhbnNmb3JtT2JqZWN0QUNMID0gKHsgQUNMLCAuLi5yZXN1bHQgfSkgPT4ge1xuICBpZiAoIUFDTCkge1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICByZXN1bHQuX3dwZXJtID0gW107XG4gIHJlc3VsdC5fcnBlcm0gPSBbXTtcblxuICBmb3IgKGNvbnN0IGVudHJ5IGluIEFDTCkge1xuICAgIGlmIChBQ0xbZW50cnldLnJlYWQpIHtcbiAgICAgIHJlc3VsdC5fcnBlcm0ucHVzaChlbnRyeSk7XG4gICAgfVxuICAgIGlmIChBQ0xbZW50cnldLndyaXRlKSB7XG4gICAgICByZXN1bHQuX3dwZXJtLnB1c2goZW50cnkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufTtcblxuY29uc3Qgc3BlY2lhbFF1ZXJ5a2V5cyA9IFtcbiAgJyRhbmQnLFxuICAnJG9yJyxcbiAgJyRub3InLFxuICAnX3JwZXJtJyxcbiAgJ193cGVybScsXG4gICdfcGVyaXNoYWJsZV90b2tlbicsXG4gICdfZW1haWxfdmVyaWZ5X3Rva2VuJyxcbiAgJ19lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdCcsXG4gICdfYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQnLFxuICAnX2ZhaWxlZF9sb2dpbl9jb3VudCcsXG5dO1xuXG5jb25zdCBpc1NwZWNpYWxRdWVyeUtleSA9IGtleSA9PiB7XG4gIHJldHVybiBzcGVjaWFsUXVlcnlrZXlzLmluZGV4T2Yoa2V5KSA+PSAwO1xufTtcblxuY29uc3QgdmFsaWRhdGVRdWVyeSA9IChxdWVyeTogYW55KTogdm9pZCA9PiB7XG4gIGlmIChxdWVyeS5BQ0wpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSwgJ0Nhbm5vdCBxdWVyeSBvbiBBQ0wuJyk7XG4gIH1cblxuICBpZiAocXVlcnkuJG9yKSB7XG4gICAgaWYgKHF1ZXJ5LiRvciBpbnN0YW5jZW9mIEFycmF5KSB7XG4gICAgICBxdWVyeS4kb3IuZm9yRWFjaCh2YWxpZGF0ZVF1ZXJ5KTtcblxuICAgICAgLyogSW4gTW9uZ29EQiwgJG9yIHF1ZXJpZXMgd2hpY2ggYXJlIG5vdCBhbG9uZSBhdCB0aGUgdG9wIGxldmVsIG9mIHRoZVxuICAgICAgICogcXVlcnkgY2FuIG5vdCBtYWtlIGVmZmljaWVudCB1c2Ugb2YgaW5kZXhlcyBkdWUgdG8gYSBsb25nIHN0YW5kaW5nXG4gICAgICAgKiBidWcga25vd24gYXMgU0VSVkVSLTEzNzMyLlxuICAgICAgICpcbiAgICAgICAqIFRoaXMgYmxvY2sgcmVzdHJ1Y3R1cmVzIHF1ZXJpZXMgaW4gd2hpY2ggJG9yIGlzIG5vdCB0aGUgc29sZSB0b3BcbiAgICAgICAqIGxldmVsIGVsZW1lbnQgYnkgbW92aW5nIGFsbCBvdGhlciB0b3AtbGV2ZWwgcHJlZGljYXRlcyBpbnNpZGUgZXZlcnlcbiAgICAgICAqIHN1YmRvY3VtZW50IG9mIHRoZSAkb3IgcHJlZGljYXRlLCBhbGxvd2luZyBNb25nb0RCJ3MgcXVlcnkgcGxhbm5lclxuICAgICAgICogdG8gbWFrZSBmdWxsIHVzZSBvZiB0aGUgbW9zdCByZWxldmFudCBpbmRleGVzLlxuICAgICAgICpcbiAgICAgICAqIEVHOiAgICAgIHskb3I6IFt7YTogMX0sIHthOiAyfV0sIGI6IDJ9XG4gICAgICAgKiBCZWNvbWVzOiB7JG9yOiBbe2E6IDEsIGI6IDJ9LCB7YTogMiwgYjogMn1dfVxuICAgICAgICpcbiAgICAgICAqIFRoZSBvbmx5IGV4Y2VwdGlvbnMgYXJlICRuZWFyIGFuZCAkbmVhclNwaGVyZSBvcGVyYXRvcnMsIHdoaWNoIGFyZVxuICAgICAgICogY29uc3RyYWluZWQgdG8gb25seSAxIG9wZXJhdG9yIHBlciBxdWVyeS4gQXMgYSByZXN1bHQsIHRoZXNlIG9wc1xuICAgICAgICogcmVtYWluIGF0IHRoZSB0b3AgbGV2ZWxcbiAgICAgICAqXG4gICAgICAgKiBodHRwczovL2ppcmEubW9uZ29kYi5vcmcvYnJvd3NlL1NFUlZFUi0xMzczMlxuICAgICAgICogaHR0cHM6Ly9naXRodWIuY29tL3BhcnNlLWNvbW11bml0eS9wYXJzZS1zZXJ2ZXIvaXNzdWVzLzM3NjdcbiAgICAgICAqL1xuICAgICAgT2JqZWN0LmtleXMocXVlcnkpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgICAgY29uc3Qgbm9Db2xsaXNpb25zID0gIXF1ZXJ5LiRvci5zb21lKHN1YnEgPT4gc3VicS5oYXNPd25Qcm9wZXJ0eShrZXkpKTtcbiAgICAgICAgbGV0IGhhc05lYXJzID0gZmFsc2U7XG4gICAgICAgIGlmIChxdWVyeVtrZXldICE9IG51bGwgJiYgdHlwZW9mIHF1ZXJ5W2tleV0gPT0gJ29iamVjdCcpIHtcbiAgICAgICAgICBoYXNOZWFycyA9ICckbmVhcicgaW4gcXVlcnlba2V5XSB8fCAnJG5lYXJTcGhlcmUnIGluIHF1ZXJ5W2tleV07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGtleSAhPSAnJG9yJyAmJiBub0NvbGxpc2lvbnMgJiYgIWhhc05lYXJzKSB7XG4gICAgICAgICAgcXVlcnkuJG9yLmZvckVhY2goc3VicXVlcnkgPT4ge1xuICAgICAgICAgICAgc3VicXVlcnlba2V5XSA9IHF1ZXJ5W2tleV07XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgZGVsZXRlIHF1ZXJ5W2tleV07XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgcXVlcnkuJG9yLmZvckVhY2godmFsaWRhdGVRdWVyeSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSxcbiAgICAgICAgJ0JhZCAkb3IgZm9ybWF0IC0gdXNlIGFuIGFycmF5IHZhbHVlLidcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgaWYgKHF1ZXJ5LiRhbmQpIHtcbiAgICBpZiAocXVlcnkuJGFuZCBpbnN0YW5jZW9mIEFycmF5KSB7XG4gICAgICBxdWVyeS4kYW5kLmZvckVhY2godmFsaWRhdGVRdWVyeSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSxcbiAgICAgICAgJ0JhZCAkYW5kIGZvcm1hdCAtIHVzZSBhbiBhcnJheSB2YWx1ZS4nXG4gICAgICApO1xuICAgIH1cbiAgfVxuXG4gIGlmIChxdWVyeS4kbm9yKSB7XG4gICAgaWYgKHF1ZXJ5LiRub3IgaW5zdGFuY2VvZiBBcnJheSAmJiBxdWVyeS4kbm9yLmxlbmd0aCA+IDApIHtcbiAgICAgIHF1ZXJ5LiRub3IuZm9yRWFjaCh2YWxpZGF0ZVF1ZXJ5KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLFxuICAgICAgICAnQmFkICRub3IgZm9ybWF0IC0gdXNlIGFuIGFycmF5IG9mIGF0IGxlYXN0IDEgdmFsdWUuJ1xuICAgICAgKTtcbiAgICB9XG4gIH1cblxuICBPYmplY3Qua2V5cyhxdWVyeSkuZm9yRWFjaChrZXkgPT4ge1xuICAgIGlmIChxdWVyeSAmJiBxdWVyeVtrZXldICYmIHF1ZXJ5W2tleV0uJHJlZ2V4KSB7XG4gICAgICBpZiAodHlwZW9mIHF1ZXJ5W2tleV0uJG9wdGlvbnMgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIGlmICghcXVlcnlba2V5XS4kb3B0aW9ucy5tYXRjaCgvXltpbXhzXSskLykpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLFxuICAgICAgICAgICAgYEJhZCAkb3B0aW9ucyB2YWx1ZSBmb3IgcXVlcnk6ICR7cXVlcnlba2V5XS4kb3B0aW9uc31gXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBpZiAoIWlzU3BlY2lhbFF1ZXJ5S2V5KGtleSkgJiYgIWtleS5tYXRjaCgvXlthLXpBLVpdW2EtekEtWjAtOV9cXC5dKiQvKSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLFxuICAgICAgICBgSW52YWxpZCBrZXkgbmFtZTogJHtrZXl9YFxuICAgICAgKTtcbiAgICB9XG4gIH0pO1xufTtcblxuLy8gRmlsdGVycyBvdXQgYW55IGRhdGEgdGhhdCBzaG91bGRuJ3QgYmUgb24gdGhpcyBSRVNULWZvcm1hdHRlZCBvYmplY3QuXG5jb25zdCBmaWx0ZXJTZW5zaXRpdmVEYXRhID0gKFxuICBpc01hc3RlcixcbiAgYWNsR3JvdXAsXG4gIGNsYXNzTmFtZSxcbiAgcHJvdGVjdGVkRmllbGRzLFxuICBvYmplY3RcbikgPT4ge1xuICBwcm90ZWN0ZWRGaWVsZHMgJiYgcHJvdGVjdGVkRmllbGRzLmZvckVhY2goayA9PiBkZWxldGUgb2JqZWN0W2tdKTtcblxuICBpZiAoY2xhc3NOYW1lICE9PSAnX1VzZXInKSB7XG4gICAgcmV0dXJuIG9iamVjdDtcbiAgfVxuXG4gIG9iamVjdC5wYXNzd29yZCA9IG9iamVjdC5faGFzaGVkX3Bhc3N3b3JkO1xuICBkZWxldGUgb2JqZWN0Ll9oYXNoZWRfcGFzc3dvcmQ7XG5cbiAgZGVsZXRlIG9iamVjdC5zZXNzaW9uVG9rZW47XG5cbiAgaWYgKGlzTWFzdGVyKSB7XG4gICAgcmV0dXJuIG9iamVjdDtcbiAgfVxuICBkZWxldGUgb2JqZWN0Ll9lbWFpbF92ZXJpZnlfdG9rZW47XG4gIGRlbGV0ZSBvYmplY3QuX3BlcmlzaGFibGVfdG9rZW47XG4gIGRlbGV0ZSBvYmplY3QuX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdDtcbiAgZGVsZXRlIG9iamVjdC5fdG9tYnN0b25lO1xuICBkZWxldGUgb2JqZWN0Ll9lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdDtcbiAgZGVsZXRlIG9iamVjdC5fZmFpbGVkX2xvZ2luX2NvdW50O1xuICBkZWxldGUgb2JqZWN0Ll9hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdDtcbiAgZGVsZXRlIG9iamVjdC5fcGFzc3dvcmRfY2hhbmdlZF9hdDtcbiAgZGVsZXRlIG9iamVjdC5fcGFzc3dvcmRfaGlzdG9yeTtcblxuICBpZiAoYWNsR3JvdXAuaW5kZXhPZihvYmplY3Qub2JqZWN0SWQpID4gLTEpIHtcbiAgICByZXR1cm4gb2JqZWN0O1xuICB9XG4gIGRlbGV0ZSBvYmplY3QuYXV0aERhdGE7XG4gIHJldHVybiBvYmplY3Q7XG59O1xuXG5pbXBvcnQgdHlwZSB7IExvYWRTY2hlbWFPcHRpb25zIH0gZnJvbSAnLi90eXBlcyc7XG5cbi8vIFJ1bnMgYW4gdXBkYXRlIG9uIHRoZSBkYXRhYmFzZS5cbi8vIFJldHVybnMgYSBwcm9taXNlIGZvciBhbiBvYmplY3Qgd2l0aCB0aGUgbmV3IHZhbHVlcyBmb3IgZmllbGRcbi8vIG1vZGlmaWNhdGlvbnMgdGhhdCBkb24ndCBrbm93IHRoZWlyIHJlc3VsdHMgYWhlYWQgb2YgdGltZSwgbGlrZVxuLy8gJ2luY3JlbWVudCcuXG4vLyBPcHRpb25zOlxuLy8gICBhY2w6ICBhIGxpc3Qgb2Ygc3RyaW5ncy4gSWYgdGhlIG9iamVjdCB0byBiZSB1cGRhdGVkIGhhcyBhbiBBQ0wsXG4vLyAgICAgICAgIG9uZSBvZiB0aGUgcHJvdmlkZWQgc3RyaW5ncyBtdXN0IHByb3ZpZGUgdGhlIGNhbGxlciB3aXRoXG4vLyAgICAgICAgIHdyaXRlIHBlcm1pc3Npb25zLlxuY29uc3Qgc3BlY2lhbEtleXNGb3JVcGRhdGUgPSBbXG4gICdfaGFzaGVkX3Bhc3N3b3JkJyxcbiAgJ19wZXJpc2hhYmxlX3Rva2VuJyxcbiAgJ19lbWFpbF92ZXJpZnlfdG9rZW4nLFxuICAnX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0JyxcbiAgJ19hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCcsXG4gICdfZmFpbGVkX2xvZ2luX2NvdW50JyxcbiAgJ19wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQnLFxuICAnX3Bhc3N3b3JkX2NoYW5nZWRfYXQnLFxuICAnX3Bhc3N3b3JkX2hpc3RvcnknLFxuXTtcblxuY29uc3QgaXNTcGVjaWFsVXBkYXRlS2V5ID0ga2V5ID0+IHtcbiAgcmV0dXJuIHNwZWNpYWxLZXlzRm9yVXBkYXRlLmluZGV4T2Yoa2V5KSA+PSAwO1xufTtcblxuZnVuY3Rpb24gZXhwYW5kUmVzdWx0T25LZXlQYXRoKG9iamVjdCwga2V5LCB2YWx1ZSkge1xuICBpZiAoa2V5LmluZGV4T2YoJy4nKSA8IDApIHtcbiAgICBvYmplY3Rba2V5XSA9IHZhbHVlW2tleV07XG4gICAgcmV0dXJuIG9iamVjdDtcbiAgfVxuICBjb25zdCBwYXRoID0ga2V5LnNwbGl0KCcuJyk7XG4gIGNvbnN0IGZpcnN0S2V5ID0gcGF0aFswXTtcbiAgY29uc3QgbmV4dFBhdGggPSBwYXRoLnNsaWNlKDEpLmpvaW4oJy4nKTtcbiAgb2JqZWN0W2ZpcnN0S2V5XSA9IGV4cGFuZFJlc3VsdE9uS2V5UGF0aChcbiAgICBvYmplY3RbZmlyc3RLZXldIHx8IHt9LFxuICAgIG5leHRQYXRoLFxuICAgIHZhbHVlW2ZpcnN0S2V5XVxuICApO1xuICBkZWxldGUgb2JqZWN0W2tleV07XG4gIHJldHVybiBvYmplY3Q7XG59XG5cbmZ1bmN0aW9uIHNhbml0aXplRGF0YWJhc2VSZXN1bHQob3JpZ2luYWxPYmplY3QsIHJlc3VsdCk6IFByb21pc2U8YW55PiB7XG4gIGNvbnN0IHJlc3BvbnNlID0ge307XG4gIGlmICghcmVzdWx0KSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShyZXNwb25zZSk7XG4gIH1cbiAgT2JqZWN0LmtleXMob3JpZ2luYWxPYmplY3QpLmZvckVhY2goa2V5ID0+IHtcbiAgICBjb25zdCBrZXlVcGRhdGUgPSBvcmlnaW5hbE9iamVjdFtrZXldO1xuICAgIC8vIGRldGVybWluZSBpZiB0aGF0IHdhcyBhbiBvcFxuICAgIGlmIChcbiAgICAgIGtleVVwZGF0ZSAmJlxuICAgICAgdHlwZW9mIGtleVVwZGF0ZSA9PT0gJ29iamVjdCcgJiZcbiAgICAgIGtleVVwZGF0ZS5fX29wICYmXG4gICAgICBbJ0FkZCcsICdBZGRVbmlxdWUnLCAnUmVtb3ZlJywgJ0luY3JlbWVudCddLmluZGV4T2Yoa2V5VXBkYXRlLl9fb3ApID4gLTFcbiAgICApIHtcbiAgICAgIC8vIG9ubHkgdmFsaWQgb3BzIHRoYXQgcHJvZHVjZSBhbiBhY3Rpb25hYmxlIHJlc3VsdFxuICAgICAgLy8gdGhlIG9wIG1heSBoYXZlIGhhcHBlbmQgb24gYSBrZXlwYXRoXG4gICAgICBleHBhbmRSZXN1bHRPbktleVBhdGgocmVzcG9uc2UsIGtleSwgcmVzdWx0KTtcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHJlc3BvbnNlKTtcbn1cblxuZnVuY3Rpb24gam9pblRhYmxlTmFtZShjbGFzc05hbWUsIGtleSkge1xuICByZXR1cm4gYF9Kb2luOiR7a2V5fToke2NsYXNzTmFtZX1gO1xufVxuXG5jb25zdCBmbGF0dGVuVXBkYXRlT3BlcmF0b3JzRm9yQ3JlYXRlID0gb2JqZWN0ID0+IHtcbiAgZm9yIChjb25zdCBrZXkgaW4gb2JqZWN0KSB7XG4gICAgaWYgKG9iamVjdFtrZXldICYmIG9iamVjdFtrZXldLl9fb3ApIHtcbiAgICAgIHN3aXRjaCAob2JqZWN0W2tleV0uX19vcCkge1xuICAgICAgICBjYXNlICdJbmNyZW1lbnQnOlxuICAgICAgICAgIGlmICh0eXBlb2Ygb2JqZWN0W2tleV0uYW1vdW50ICE9PSAnbnVtYmVyJykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICAgICdvYmplY3RzIHRvIGFkZCBtdXN0IGJlIGFuIGFycmF5J1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgb2JqZWN0W2tleV0gPSBvYmplY3Rba2V5XS5hbW91bnQ7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ0FkZCc6XG4gICAgICAgICAgaWYgKCEob2JqZWN0W2tleV0ub2JqZWN0cyBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICAgICdvYmplY3RzIHRvIGFkZCBtdXN0IGJlIGFuIGFycmF5J1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgb2JqZWN0W2tleV0gPSBvYmplY3Rba2V5XS5vYmplY3RzO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdBZGRVbmlxdWUnOlxuICAgICAgICAgIGlmICghKG9iamVjdFtrZXldLm9iamVjdHMgaW5zdGFuY2VvZiBBcnJheSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgICAnb2JqZWN0cyB0byBhZGQgbXVzdCBiZSBhbiBhcnJheSdcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIG9iamVjdFtrZXldID0gb2JqZWN0W2tleV0ub2JqZWN0cztcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnUmVtb3ZlJzpcbiAgICAgICAgICBpZiAoIShvYmplY3Rba2V5XS5vYmplY3RzIGluc3RhbmNlb2YgQXJyYXkpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICAgJ29iamVjdHMgdG8gYWRkIG11c3QgYmUgYW4gYXJyYXknXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBvYmplY3Rba2V5XSA9IFtdO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdEZWxldGUnOlxuICAgICAgICAgIGRlbGV0ZSBvYmplY3Rba2V5XTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5DT01NQU5EX1VOQVZBSUxBQkxFLFxuICAgICAgICAgICAgYFRoZSAke29iamVjdFtrZXldLl9fb3B9IG9wZXJhdG9yIGlzIG5vdCBzdXBwb3J0ZWQgeWV0LmBcbiAgICAgICAgICApO1xuICAgICAgfVxuICAgIH1cbiAgfVxufTtcblxuY29uc3QgdHJhbnNmb3JtQXV0aERhdGEgPSAoY2xhc3NOYW1lLCBvYmplY3QsIHNjaGVtYSkgPT4ge1xuICBpZiAob2JqZWN0LmF1dGhEYXRhICYmIGNsYXNzTmFtZSA9PT0gJ19Vc2VyJykge1xuICAgIE9iamVjdC5rZXlzKG9iamVjdC5hdXRoRGF0YSkuZm9yRWFjaChwcm92aWRlciA9PiB7XG4gICAgICBjb25zdCBwcm92aWRlckRhdGEgPSBvYmplY3QuYXV0aERhdGFbcHJvdmlkZXJdO1xuICAgICAgY29uc3QgZmllbGROYW1lID0gYF9hdXRoX2RhdGFfJHtwcm92aWRlcn1gO1xuICAgICAgaWYgKHByb3ZpZGVyRGF0YSA9PSBudWxsKSB7XG4gICAgICAgIG9iamVjdFtmaWVsZE5hbWVdID0ge1xuICAgICAgICAgIF9fb3A6ICdEZWxldGUnLFxuICAgICAgICB9O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgb2JqZWN0W2ZpZWxkTmFtZV0gPSBwcm92aWRlckRhdGE7XG4gICAgICAgIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXSA9IHsgdHlwZTogJ09iamVjdCcgfTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBkZWxldGUgb2JqZWN0LmF1dGhEYXRhO1xuICB9XG59O1xuLy8gVHJhbnNmb3JtcyBhIERhdGFiYXNlIGZvcm1hdCBBQ0wgdG8gYSBSRVNUIEFQSSBmb3JtYXQgQUNMXG5jb25zdCB1bnRyYW5zZm9ybU9iamVjdEFDTCA9ICh7IF9ycGVybSwgX3dwZXJtLCAuLi5vdXRwdXQgfSkgPT4ge1xuICBpZiAoX3JwZXJtIHx8IF93cGVybSkge1xuICAgIG91dHB1dC5BQ0wgPSB7fTtcblxuICAgIChfcnBlcm0gfHwgW10pLmZvckVhY2goZW50cnkgPT4ge1xuICAgICAgaWYgKCFvdXRwdXQuQUNMW2VudHJ5XSkge1xuICAgICAgICBvdXRwdXQuQUNMW2VudHJ5XSA9IHsgcmVhZDogdHJ1ZSB9O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgb3V0cHV0LkFDTFtlbnRyeV1bJ3JlYWQnXSA9IHRydWU7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAoX3dwZXJtIHx8IFtdKS5mb3JFYWNoKGVudHJ5ID0+IHtcbiAgICAgIGlmICghb3V0cHV0LkFDTFtlbnRyeV0pIHtcbiAgICAgICAgb3V0cHV0LkFDTFtlbnRyeV0gPSB7IHdyaXRlOiB0cnVlIH07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBvdXRwdXQuQUNMW2VudHJ5XVsnd3JpdGUnXSA9IHRydWU7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cbiAgcmV0dXJuIG91dHB1dDtcbn07XG5cbi8qKlxuICogV2hlbiBxdWVyeWluZywgdGhlIGZpZWxkTmFtZSBtYXkgYmUgY29tcG91bmQsIGV4dHJhY3QgdGhlIHJvb3QgZmllbGROYW1lXG4gKiAgICAgYHRlbXBlcmF0dXJlLmNlbHNpdXNgIGJlY29tZXMgYHRlbXBlcmF0dXJlYFxuICogQHBhcmFtIHtzdHJpbmd9IGZpZWxkTmFtZSB0aGF0IG1heSBiZSBhIGNvbXBvdW5kIGZpZWxkIG5hbWVcbiAqIEByZXR1cm5zIHtzdHJpbmd9IHRoZSByb290IG5hbWUgb2YgdGhlIGZpZWxkXG4gKi9cbmNvbnN0IGdldFJvb3RGaWVsZE5hbWUgPSAoZmllbGROYW1lOiBzdHJpbmcpOiBzdHJpbmcgPT4ge1xuICByZXR1cm4gZmllbGROYW1lLnNwbGl0KCcuJylbMF07XG59O1xuXG5jb25zdCByZWxhdGlvblNjaGVtYSA9IHtcbiAgZmllbGRzOiB7IHJlbGF0ZWRJZDogeyB0eXBlOiAnU3RyaW5nJyB9LCBvd25pbmdJZDogeyB0eXBlOiAnU3RyaW5nJyB9IH0sXG59O1xuXG5jbGFzcyBEYXRhYmFzZUNvbnRyb2xsZXIge1xuICBhZGFwdGVyOiBTdG9yYWdlQWRhcHRlcjtcbiAgc2NoZW1hQ2FjaGU6IGFueTtcbiAgc2NoZW1hUHJvbWlzZTogP1Byb21pc2U8U2NoZW1hQ29udHJvbGxlci5TY2hlbWFDb250cm9sbGVyPjtcblxuICBjb25zdHJ1Y3RvcihhZGFwdGVyOiBTdG9yYWdlQWRhcHRlciwgc2NoZW1hQ2FjaGU6IGFueSkge1xuICAgIHRoaXMuYWRhcHRlciA9IGFkYXB0ZXI7XG4gICAgdGhpcy5zY2hlbWFDYWNoZSA9IHNjaGVtYUNhY2hlO1xuICAgIC8vIFdlIGRvbid0IHdhbnQgYSBtdXRhYmxlIHRoaXMuc2NoZW1hLCBiZWNhdXNlIHRoZW4geW91IGNvdWxkIGhhdmVcbiAgICAvLyBvbmUgcmVxdWVzdCB0aGF0IHVzZXMgZGlmZmVyZW50IHNjaGVtYXMgZm9yIGRpZmZlcmVudCBwYXJ0cyBvZlxuICAgIC8vIGl0LiBJbnN0ZWFkLCB1c2UgbG9hZFNjaGVtYSB0byBnZXQgYSBzY2hlbWEuXG4gICAgdGhpcy5zY2hlbWFQcm9taXNlID0gbnVsbDtcbiAgfVxuXG4gIGNvbGxlY3Rpb25FeGlzdHMoY2xhc3NOYW1lOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICByZXR1cm4gdGhpcy5hZGFwdGVyLmNsYXNzRXhpc3RzKGNsYXNzTmFtZSk7XG4gIH1cblxuICBwdXJnZUNvbGxlY3Rpb24oY2xhc3NOYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gdGhpcy5sb2FkU2NoZW1hKClcbiAgICAgIC50aGVuKHNjaGVtYUNvbnRyb2xsZXIgPT4gc2NoZW1hQ29udHJvbGxlci5nZXRPbmVTY2hlbWEoY2xhc3NOYW1lKSlcbiAgICAgIC50aGVuKHNjaGVtYSA9PiB0aGlzLmFkYXB0ZXIuZGVsZXRlT2JqZWN0c0J5UXVlcnkoY2xhc3NOYW1lLCBzY2hlbWEsIHt9KSk7XG4gIH1cblxuICB2YWxpZGF0ZUNsYXNzTmFtZShjbGFzc05hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghU2NoZW1hQ29udHJvbGxlci5jbGFzc05hbWVJc1ZhbGlkKGNsYXNzTmFtZSkpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChcbiAgICAgICAgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfQ0xBU1NfTkFNRSxcbiAgICAgICAgICAnaW52YWxpZCBjbGFzc05hbWU6ICcgKyBjbGFzc05hbWVcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgZm9yIGEgc2NoZW1hQ29udHJvbGxlci5cbiAgbG9hZFNjaGVtYShcbiAgICBvcHRpb25zOiBMb2FkU2NoZW1hT3B0aW9ucyA9IHsgY2xlYXJDYWNoZTogZmFsc2UgfVxuICApOiBQcm9taXNlPFNjaGVtYUNvbnRyb2xsZXIuU2NoZW1hQ29udHJvbGxlcj4ge1xuICAgIGlmICh0aGlzLnNjaGVtYVByb21pc2UgIT0gbnVsbCkge1xuICAgICAgcmV0dXJuIHRoaXMuc2NoZW1hUHJvbWlzZTtcbiAgICB9XG4gICAgdGhpcy5zY2hlbWFQcm9taXNlID0gU2NoZW1hQ29udHJvbGxlci5sb2FkKFxuICAgICAgdGhpcy5hZGFwdGVyLFxuICAgICAgdGhpcy5zY2hlbWFDYWNoZSxcbiAgICAgIG9wdGlvbnNcbiAgICApO1xuICAgIHRoaXMuc2NoZW1hUHJvbWlzZS50aGVuKFxuICAgICAgKCkgPT4gZGVsZXRlIHRoaXMuc2NoZW1hUHJvbWlzZSxcbiAgICAgICgpID0+IGRlbGV0ZSB0aGlzLnNjaGVtYVByb21pc2VcbiAgICApO1xuICAgIHJldHVybiB0aGlzLmxvYWRTY2hlbWEob3B0aW9ucyk7XG4gIH1cblxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSBmb3IgdGhlIGNsYXNzbmFtZSB0aGF0IGlzIHJlbGF0ZWQgdG8gdGhlIGdpdmVuXG4gIC8vIGNsYXNzbmFtZSB0aHJvdWdoIHRoZSBrZXkuXG4gIC8vIFRPRE86IG1ha2UgdGhpcyBub3QgaW4gdGhlIERhdGFiYXNlQ29udHJvbGxlciBpbnRlcmZhY2VcbiAgcmVkaXJlY3RDbGFzc05hbWVGb3JLZXkoY2xhc3NOYW1lOiBzdHJpbmcsIGtleTogc3RyaW5nKTogUHJvbWlzZTw/c3RyaW5nPiB7XG4gICAgcmV0dXJuIHRoaXMubG9hZFNjaGVtYSgpLnRoZW4oc2NoZW1hID0+IHtcbiAgICAgIHZhciB0ID0gc2NoZW1hLmdldEV4cGVjdGVkVHlwZShjbGFzc05hbWUsIGtleSk7XG4gICAgICBpZiAodCAhPSBudWxsICYmIHR5cGVvZiB0ICE9PSAnc3RyaW5nJyAmJiB0LnR5cGUgPT09ICdSZWxhdGlvbicpIHtcbiAgICAgICAgcmV0dXJuIHQudGFyZ2V0Q2xhc3M7XG4gICAgICB9XG4gICAgICByZXR1cm4gY2xhc3NOYW1lO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gVXNlcyB0aGUgc2NoZW1hIHRvIHZhbGlkYXRlIHRoZSBvYmplY3QgKFJFU1QgQVBJIGZvcm1hdCkuXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gdGhlIG5ldyBzY2hlbWEuXG4gIC8vIFRoaXMgZG9lcyBub3QgdXBkYXRlIHRoaXMuc2NoZW1hLCBiZWNhdXNlIGluIGEgc2l0dWF0aW9uIGxpa2UgYVxuICAvLyBiYXRjaCByZXF1ZXN0LCB0aGF0IGNvdWxkIGNvbmZ1c2Ugb3RoZXIgdXNlcnMgb2YgdGhlIHNjaGVtYS5cbiAgdmFsaWRhdGVPYmplY3QoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0OiBhbnksXG4gICAgcXVlcnk6IGFueSxcbiAgICB7IGFjbCB9OiBRdWVyeU9wdGlvbnNcbiAgKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgbGV0IHNjaGVtYTtcbiAgICBjb25zdCBpc01hc3RlciA9IGFjbCA9PT0gdW5kZWZpbmVkO1xuICAgIHZhciBhY2xHcm91cDogc3RyaW5nW10gPSBhY2wgfHwgW107XG4gICAgcmV0dXJuIHRoaXMubG9hZFNjaGVtYSgpXG4gICAgICAudGhlbihzID0+IHtcbiAgICAgICAgc2NoZW1hID0gcztcbiAgICAgICAgaWYgKGlzTWFzdGVyKSB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmNhbkFkZEZpZWxkKHNjaGVtYSwgY2xhc3NOYW1lLCBvYmplY3QsIGFjbEdyb3VwKTtcbiAgICAgIH0pXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIHJldHVybiBzY2hlbWEudmFsaWRhdGVPYmplY3QoY2xhc3NOYW1lLCBvYmplY3QsIHF1ZXJ5KTtcbiAgICAgIH0pO1xuICB9XG5cbiAgdXBkYXRlKFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIHF1ZXJ5OiBhbnksXG4gICAgdXBkYXRlOiBhbnksXG4gICAgeyBhY2wsIG1hbnksIHVwc2VydCB9OiBGdWxsUXVlcnlPcHRpb25zID0ge30sXG4gICAgc2tpcFNhbml0aXphdGlvbjogYm9vbGVhbiA9IGZhbHNlXG4gICk6IFByb21pc2U8YW55PiB7XG4gICAgY29uc3Qgb3JpZ2luYWxRdWVyeSA9IHF1ZXJ5O1xuICAgIGNvbnN0IG9yaWdpbmFsVXBkYXRlID0gdXBkYXRlO1xuICAgIC8vIE1ha2UgYSBjb3B5IG9mIHRoZSBvYmplY3QsIHNvIHdlIGRvbid0IG11dGF0ZSB0aGUgaW5jb21pbmcgZGF0YS5cbiAgICB1cGRhdGUgPSBkZWVwY29weSh1cGRhdGUpO1xuICAgIHZhciByZWxhdGlvblVwZGF0ZXMgPSBbXTtcbiAgICB2YXIgaXNNYXN0ZXIgPSBhY2wgPT09IHVuZGVmaW5lZDtcbiAgICB2YXIgYWNsR3JvdXAgPSBhY2wgfHwgW107XG4gICAgcmV0dXJuIHRoaXMubG9hZFNjaGVtYSgpLnRoZW4oc2NoZW1hQ29udHJvbGxlciA9PiB7XG4gICAgICByZXR1cm4gKGlzTWFzdGVyXG4gICAgICAgID8gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAgICAgOiBzY2hlbWFDb250cm9sbGVyLnZhbGlkYXRlUGVybWlzc2lvbihjbGFzc05hbWUsIGFjbEdyb3VwLCAndXBkYXRlJylcbiAgICAgIClcbiAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIHJlbGF0aW9uVXBkYXRlcyA9IHRoaXMuY29sbGVjdFJlbGF0aW9uVXBkYXRlcyhcbiAgICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICAgIG9yaWdpbmFsUXVlcnkub2JqZWN0SWQsXG4gICAgICAgICAgICB1cGRhdGVcbiAgICAgICAgICApO1xuICAgICAgICAgIGlmICghaXNNYXN0ZXIpIHtcbiAgICAgICAgICAgIHF1ZXJ5ID0gdGhpcy5hZGRQb2ludGVyUGVybWlzc2lvbnMoXG4gICAgICAgICAgICAgIHNjaGVtYUNvbnRyb2xsZXIsXG4gICAgICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgJ3VwZGF0ZScsXG4gICAgICAgICAgICAgIHF1ZXJ5LFxuICAgICAgICAgICAgICBhY2xHcm91cFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKCFxdWVyeSkge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoYWNsKSB7XG4gICAgICAgICAgICBxdWVyeSA9IGFkZFdyaXRlQUNMKHF1ZXJ5LCBhY2wpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB2YWxpZGF0ZVF1ZXJ5KHF1ZXJ5KTtcbiAgICAgICAgICByZXR1cm4gc2NoZW1hQ29udHJvbGxlclxuICAgICAgICAgICAgLmdldE9uZVNjaGVtYShjbGFzc05hbWUsIHRydWUpXG4gICAgICAgICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICAgICAgICAvLyBJZiB0aGUgc2NoZW1hIGRvZXNuJ3QgZXhpc3QsIHByZXRlbmQgaXQgZXhpc3RzIHdpdGggbm8gZmllbGRzLiBUaGlzIGJlaGF2aW9yXG4gICAgICAgICAgICAgIC8vIHdpbGwgbGlrZWx5IG5lZWQgcmV2aXNpdGluZy5cbiAgICAgICAgICAgICAgaWYgKGVycm9yID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4geyBmaWVsZHM6IHt9IH07XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLnRoZW4oc2NoZW1hID0+IHtcbiAgICAgICAgICAgICAgT2JqZWN0LmtleXModXBkYXRlKS5mb3JFYWNoKGZpZWxkTmFtZSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKGZpZWxkTmFtZS5tYXRjaCgvXmF1dGhEYXRhXFwuKFthLXpBLVowLTlfXSspXFwuaWQkLykpIHtcbiAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSxcbiAgICAgICAgICAgICAgICAgICAgYEludmFsaWQgZmllbGQgbmFtZSBmb3IgdXBkYXRlOiAke2ZpZWxkTmFtZX1gXG4gICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjb25zdCByb290RmllbGROYW1lID0gZ2V0Um9vdEZpZWxkTmFtZShmaWVsZE5hbWUpO1xuICAgICAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgICAgICFTY2hlbWFDb250cm9sbGVyLmZpZWxkTmFtZUlzVmFsaWQocm9vdEZpZWxkTmFtZSkgJiZcbiAgICAgICAgICAgICAgICAgICFpc1NwZWNpYWxVcGRhdGVLZXkocm9vdEZpZWxkTmFtZSlcbiAgICAgICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSxcbiAgICAgICAgICAgICAgICAgICAgYEludmFsaWQgZmllbGQgbmFtZSBmb3IgdXBkYXRlOiAke2ZpZWxkTmFtZX1gXG4gICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIGZvciAoY29uc3QgdXBkYXRlT3BlcmF0aW9uIGluIHVwZGF0ZSkge1xuICAgICAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgICAgIHVwZGF0ZVt1cGRhdGVPcGVyYXRpb25dICYmXG4gICAgICAgICAgICAgICAgICB0eXBlb2YgdXBkYXRlW3VwZGF0ZU9wZXJhdGlvbl0gPT09ICdvYmplY3QnICYmXG4gICAgICAgICAgICAgICAgICBPYmplY3Qua2V5cyh1cGRhdGVbdXBkYXRlT3BlcmF0aW9uXSkuc29tZShcbiAgICAgICAgICAgICAgICAgICAgaW5uZXJLZXkgPT4gaW5uZXJLZXkuaW5jbHVkZXMoJyQnKSB8fCBpbm5lcktleS5pbmNsdWRlcygnLicpXG4gICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfTkVTVEVEX0tFWSxcbiAgICAgICAgICAgICAgICAgICAgXCJOZXN0ZWQga2V5cyBzaG91bGQgbm90IGNvbnRhaW4gdGhlICckJyBvciAnLicgY2hhcmFjdGVyc1wiXG4gICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB1cGRhdGUgPSB0cmFuc2Zvcm1PYmplY3RBQ0wodXBkYXRlKTtcbiAgICAgICAgICAgICAgdHJhbnNmb3JtQXV0aERhdGEoY2xhc3NOYW1lLCB1cGRhdGUsIHNjaGVtYSk7XG4gICAgICAgICAgICAgIGlmIChtYW55KSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuYWRhcHRlci51cGRhdGVPYmplY3RzQnlRdWVyeShcbiAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgICAgIHNjaGVtYSxcbiAgICAgICAgICAgICAgICAgIHF1ZXJ5LFxuICAgICAgICAgICAgICAgICAgdXBkYXRlXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgfSBlbHNlIGlmICh1cHNlcnQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5hZGFwdGVyLnVwc2VydE9uZU9iamVjdChcbiAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgICAgIHNjaGVtYSxcbiAgICAgICAgICAgICAgICAgIHF1ZXJ5LFxuICAgICAgICAgICAgICAgICAgdXBkYXRlXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5hZGFwdGVyLmZpbmRPbmVBbmRVcGRhdGUoXG4gICAgICAgICAgICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgICAgICAgICAgICBzY2hlbWEsXG4gICAgICAgICAgICAgICAgICBxdWVyeSxcbiAgICAgICAgICAgICAgICAgIHVwZGF0ZVxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KVxuICAgICAgICAudGhlbigocmVzdWx0OiBhbnkpID0+IHtcbiAgICAgICAgICBpZiAoIXJlc3VsdCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICBQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5ELFxuICAgICAgICAgICAgICAnT2JqZWN0IG5vdCBmb3VuZC4nXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVSZWxhdGlvblVwZGF0ZXMoXG4gICAgICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgICAgICBvcmlnaW5hbFF1ZXJ5Lm9iamVjdElkLFxuICAgICAgICAgICAgdXBkYXRlLFxuICAgICAgICAgICAgcmVsYXRpb25VcGRhdGVzXG4gICAgICAgICAgKS50aGVuKCgpID0+IHtcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pXG4gICAgICAgIC50aGVuKHJlc3VsdCA9PiB7XG4gICAgICAgICAgaWYgKHNraXBTYW5pdGl6YXRpb24pIHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocmVzdWx0KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHNhbml0aXplRGF0YWJhc2VSZXN1bHQob3JpZ2luYWxVcGRhdGUsIHJlc3VsdCk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gQ29sbGVjdCBhbGwgcmVsYXRpb24tdXBkYXRpbmcgb3BlcmF0aW9ucyBmcm9tIGEgUkVTVC1mb3JtYXQgdXBkYXRlLlxuICAvLyBSZXR1cm5zIGEgbGlzdCBvZiBhbGwgcmVsYXRpb24gdXBkYXRlcyB0byBwZXJmb3JtXG4gIC8vIFRoaXMgbXV0YXRlcyB1cGRhdGUuXG4gIGNvbGxlY3RSZWxhdGlvblVwZGF0ZXMoY2xhc3NOYW1lOiBzdHJpbmcsIG9iamVjdElkOiA/c3RyaW5nLCB1cGRhdGU6IGFueSkge1xuICAgIHZhciBvcHMgPSBbXTtcbiAgICB2YXIgZGVsZXRlTWUgPSBbXTtcbiAgICBvYmplY3RJZCA9IHVwZGF0ZS5vYmplY3RJZCB8fCBvYmplY3RJZDtcblxuICAgIHZhciBwcm9jZXNzID0gKG9wLCBrZXkpID0+IHtcbiAgICAgIGlmICghb3ApIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgaWYgKG9wLl9fb3AgPT0gJ0FkZFJlbGF0aW9uJykge1xuICAgICAgICBvcHMucHVzaCh7IGtleSwgb3AgfSk7XG4gICAgICAgIGRlbGV0ZU1lLnB1c2goa2V5KTtcbiAgICAgIH1cblxuICAgICAgaWYgKG9wLl9fb3AgPT0gJ1JlbW92ZVJlbGF0aW9uJykge1xuICAgICAgICBvcHMucHVzaCh7IGtleSwgb3AgfSk7XG4gICAgICAgIGRlbGV0ZU1lLnB1c2goa2V5KTtcbiAgICAgIH1cblxuICAgICAgaWYgKG9wLl9fb3AgPT0gJ0JhdGNoJykge1xuICAgICAgICBmb3IgKHZhciB4IG9mIG9wLm9wcykge1xuICAgICAgICAgIHByb2Nlc3MoeCwga2V5KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG5cbiAgICBmb3IgKGNvbnN0IGtleSBpbiB1cGRhdGUpIHtcbiAgICAgIHByb2Nlc3ModXBkYXRlW2tleV0sIGtleSk7XG4gICAgfVxuICAgIGZvciAoY29uc3Qga2V5IG9mIGRlbGV0ZU1lKSB7XG4gICAgICBkZWxldGUgdXBkYXRlW2tleV07XG4gICAgfVxuICAgIHJldHVybiBvcHM7XG4gIH1cblxuICAvLyBQcm9jZXNzZXMgcmVsYXRpb24tdXBkYXRpbmcgb3BlcmF0aW9ucyBmcm9tIGEgUkVTVC1mb3JtYXQgdXBkYXRlLlxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdoZW4gYWxsIHVwZGF0ZXMgaGF2ZSBiZWVuIHBlcmZvcm1lZFxuICBoYW5kbGVSZWxhdGlvblVwZGF0ZXMoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0SWQ6IHN0cmluZyxcbiAgICB1cGRhdGU6IGFueSxcbiAgICBvcHM6IGFueVxuICApIHtcbiAgICB2YXIgcGVuZGluZyA9IFtdO1xuICAgIG9iamVjdElkID0gdXBkYXRlLm9iamVjdElkIHx8IG9iamVjdElkO1xuICAgIG9wcy5mb3JFYWNoKCh7IGtleSwgb3AgfSkgPT4ge1xuICAgICAgaWYgKCFvcCkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBpZiAob3AuX19vcCA9PSAnQWRkUmVsYXRpb24nKSB7XG4gICAgICAgIGZvciAoY29uc3Qgb2JqZWN0IG9mIG9wLm9iamVjdHMpIHtcbiAgICAgICAgICBwZW5kaW5nLnB1c2goXG4gICAgICAgICAgICB0aGlzLmFkZFJlbGF0aW9uKGtleSwgY2xhc3NOYW1lLCBvYmplY3RJZCwgb2JqZWN0Lm9iamVjdElkKVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKG9wLl9fb3AgPT0gJ1JlbW92ZVJlbGF0aW9uJykge1xuICAgICAgICBmb3IgKGNvbnN0IG9iamVjdCBvZiBvcC5vYmplY3RzKSB7XG4gICAgICAgICAgcGVuZGluZy5wdXNoKFxuICAgICAgICAgICAgdGhpcy5yZW1vdmVSZWxhdGlvbihrZXksIGNsYXNzTmFtZSwgb2JqZWN0SWQsIG9iamVjdC5vYmplY3RJZClcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gUHJvbWlzZS5hbGwocGVuZGluZyk7XG4gIH1cblxuICAvLyBBZGRzIGEgcmVsYXRpb24uXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgc3VjY2Vzc2Z1bGx5IGlmZiB0aGUgYWRkIHdhcyBzdWNjZXNzZnVsLlxuICBhZGRSZWxhdGlvbihcbiAgICBrZXk6IHN0cmluZyxcbiAgICBmcm9tQ2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgZnJvbUlkOiBzdHJpbmcsXG4gICAgdG9JZDogc3RyaW5nXG4gICkge1xuICAgIGNvbnN0IGRvYyA9IHtcbiAgICAgIHJlbGF0ZWRJZDogdG9JZCxcbiAgICAgIG93bmluZ0lkOiBmcm9tSWQsXG4gICAgfTtcbiAgICByZXR1cm4gdGhpcy5hZGFwdGVyLnVwc2VydE9uZU9iamVjdChcbiAgICAgIGBfSm9pbjoke2tleX06JHtmcm9tQ2xhc3NOYW1lfWAsXG4gICAgICByZWxhdGlvblNjaGVtYSxcbiAgICAgIGRvYyxcbiAgICAgIGRvY1xuICAgICk7XG4gIH1cblxuICAvLyBSZW1vdmVzIGEgcmVsYXRpb24uXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgc3VjY2Vzc2Z1bGx5IGlmZiB0aGUgcmVtb3ZlIHdhc1xuICAvLyBzdWNjZXNzZnVsLlxuICByZW1vdmVSZWxhdGlvbihcbiAgICBrZXk6IHN0cmluZyxcbiAgICBmcm9tQ2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgZnJvbUlkOiBzdHJpbmcsXG4gICAgdG9JZDogc3RyaW5nXG4gICkge1xuICAgIHZhciBkb2MgPSB7XG4gICAgICByZWxhdGVkSWQ6IHRvSWQsXG4gICAgICBvd25pbmdJZDogZnJvbUlkLFxuICAgIH07XG4gICAgcmV0dXJuIHRoaXMuYWRhcHRlclxuICAgICAgLmRlbGV0ZU9iamVjdHNCeVF1ZXJ5KFxuICAgICAgICBgX0pvaW46JHtrZXl9OiR7ZnJvbUNsYXNzTmFtZX1gLFxuICAgICAgICByZWxhdGlvblNjaGVtYSxcbiAgICAgICAgZG9jXG4gICAgICApXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICAvLyBXZSBkb24ndCBjYXJlIGlmIHRoZXkgdHJ5IHRvIGRlbGV0ZSBhIG5vbi1leGlzdGVudCByZWxhdGlvbi5cbiAgICAgICAgaWYgKGVycm9yLmNvZGUgPT0gUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH0pO1xuICB9XG5cbiAgLy8gUmVtb3ZlcyBvYmplY3RzIG1hdGNoZXMgdGhpcyBxdWVyeSBmcm9tIHRoZSBkYXRhYmFzZS5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyBzdWNjZXNzZnVsbHkgaWZmIHRoZSBvYmplY3Qgd2FzXG4gIC8vIGRlbGV0ZWQuXG4gIC8vIE9wdGlvbnM6XG4gIC8vICAgYWNsOiAgYSBsaXN0IG9mIHN0cmluZ3MuIElmIHRoZSBvYmplY3QgdG8gYmUgdXBkYXRlZCBoYXMgYW4gQUNMLFxuICAvLyAgICAgICAgIG9uZSBvZiB0aGUgcHJvdmlkZWQgc3RyaW5ncyBtdXN0IHByb3ZpZGUgdGhlIGNhbGxlciB3aXRoXG4gIC8vICAgICAgICAgd3JpdGUgcGVybWlzc2lvbnMuXG4gIGRlc3Ryb3koXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgcXVlcnk6IGFueSxcbiAgICB7IGFjbCB9OiBRdWVyeU9wdGlvbnMgPSB7fVxuICApOiBQcm9taXNlPGFueT4ge1xuICAgIGNvbnN0IGlzTWFzdGVyID0gYWNsID09PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgYWNsR3JvdXAgPSBhY2wgfHwgW107XG5cbiAgICByZXR1cm4gdGhpcy5sb2FkU2NoZW1hKCkudGhlbihzY2hlbWFDb250cm9sbGVyID0+IHtcbiAgICAgIHJldHVybiAoaXNNYXN0ZXJcbiAgICAgICAgPyBQcm9taXNlLnJlc29sdmUoKVxuICAgICAgICA6IHNjaGVtYUNvbnRyb2xsZXIudmFsaWRhdGVQZXJtaXNzaW9uKGNsYXNzTmFtZSwgYWNsR3JvdXAsICdkZWxldGUnKVxuICAgICAgKS50aGVuKCgpID0+IHtcbiAgICAgICAgaWYgKCFpc01hc3Rlcikge1xuICAgICAgICAgIHF1ZXJ5ID0gdGhpcy5hZGRQb2ludGVyUGVybWlzc2lvbnMoXG4gICAgICAgICAgICBzY2hlbWFDb250cm9sbGVyLFxuICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgJ2RlbGV0ZScsXG4gICAgICAgICAgICBxdWVyeSxcbiAgICAgICAgICAgIGFjbEdyb3VwXG4gICAgICAgICAgKTtcbiAgICAgICAgICBpZiAoIXF1ZXJ5KSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgIFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsXG4gICAgICAgICAgICAgICdPYmplY3Qgbm90IGZvdW5kLidcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIC8vIGRlbGV0ZSBieSBxdWVyeVxuICAgICAgICBpZiAoYWNsKSB7XG4gICAgICAgICAgcXVlcnkgPSBhZGRXcml0ZUFDTChxdWVyeSwgYWNsKTtcbiAgICAgICAgfVxuICAgICAgICB2YWxpZGF0ZVF1ZXJ5KHF1ZXJ5KTtcbiAgICAgICAgcmV0dXJuIHNjaGVtYUNvbnRyb2xsZXJcbiAgICAgICAgICAuZ2V0T25lU2NoZW1hKGNsYXNzTmFtZSlcbiAgICAgICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICAgICAgLy8gSWYgdGhlIHNjaGVtYSBkb2Vzbid0IGV4aXN0LCBwcmV0ZW5kIGl0IGV4aXN0cyB3aXRoIG5vIGZpZWxkcy4gVGhpcyBiZWhhdmlvclxuICAgICAgICAgICAgLy8gd2lsbCBsaWtlbHkgbmVlZCByZXZpc2l0aW5nLlxuICAgICAgICAgICAgaWYgKGVycm9yID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIHsgZmllbGRzOiB7fSB9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAudGhlbihwYXJzZUZvcm1hdFNjaGVtYSA9PlxuICAgICAgICAgICAgdGhpcy5hZGFwdGVyLmRlbGV0ZU9iamVjdHNCeVF1ZXJ5KFxuICAgICAgICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgICAgICAgIHBhcnNlRm9ybWF0U2NoZW1hLFxuICAgICAgICAgICAgICBxdWVyeVxuICAgICAgICAgICAgKVxuICAgICAgICAgIClcbiAgICAgICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICAgICAgLy8gV2hlbiBkZWxldGluZyBzZXNzaW9ucyB3aGlsZSBjaGFuZ2luZyBwYXNzd29yZHMsIGRvbid0IHRocm93IGFuIGVycm9yIGlmIHRoZXkgZG9uJ3QgaGF2ZSBhbnkgc2Vzc2lvbnMuXG4gICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgIGNsYXNzTmFtZSA9PT0gJ19TZXNzaW9uJyAmJlxuICAgICAgICAgICAgICBlcnJvci5jb2RlID09PSBQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5EXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7fSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gSW5zZXJ0cyBhbiBvYmplY3QgaW50byB0aGUgZGF0YWJhc2UuXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgc3VjY2Vzc2Z1bGx5IGlmZiB0aGUgb2JqZWN0IHNhdmVkLlxuICBjcmVhdGUoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0OiBhbnksXG4gICAgeyBhY2wgfTogUXVlcnlPcHRpb25zID0ge31cbiAgKTogUHJvbWlzZTxhbnk+IHtcbiAgICAvLyBNYWtlIGEgY29weSBvZiB0aGUgb2JqZWN0LCBzbyB3ZSBkb24ndCBtdXRhdGUgdGhlIGluY29taW5nIGRhdGEuXG4gICAgY29uc3Qgb3JpZ2luYWxPYmplY3QgPSBvYmplY3Q7XG4gICAgb2JqZWN0ID0gdHJhbnNmb3JtT2JqZWN0QUNMKG9iamVjdCk7XG5cbiAgICBvYmplY3QuY3JlYXRlZEF0ID0geyBpc286IG9iamVjdC5jcmVhdGVkQXQsIF9fdHlwZTogJ0RhdGUnIH07XG4gICAgb2JqZWN0LnVwZGF0ZWRBdCA9IHsgaXNvOiBvYmplY3QudXBkYXRlZEF0LCBfX3R5cGU6ICdEYXRlJyB9O1xuXG4gICAgdmFyIGlzTWFzdGVyID0gYWNsID09PSB1bmRlZmluZWQ7XG4gICAgdmFyIGFjbEdyb3VwID0gYWNsIHx8IFtdO1xuICAgIGNvbnN0IHJlbGF0aW9uVXBkYXRlcyA9IHRoaXMuY29sbGVjdFJlbGF0aW9uVXBkYXRlcyhcbiAgICAgIGNsYXNzTmFtZSxcbiAgICAgIG51bGwsXG4gICAgICBvYmplY3RcbiAgICApO1xuICAgIHJldHVybiB0aGlzLnZhbGlkYXRlQ2xhc3NOYW1lKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKCgpID0+IHRoaXMubG9hZFNjaGVtYSgpKVxuICAgICAgLnRoZW4oc2NoZW1hQ29udHJvbGxlciA9PiB7XG4gICAgICAgIHJldHVybiAoaXNNYXN0ZXJcbiAgICAgICAgICA/IFByb21pc2UucmVzb2x2ZSgpXG4gICAgICAgICAgOiBzY2hlbWFDb250cm9sbGVyLnZhbGlkYXRlUGVybWlzc2lvbihjbGFzc05hbWUsIGFjbEdyb3VwLCAnY3JlYXRlJylcbiAgICAgICAgKVxuICAgICAgICAgIC50aGVuKCgpID0+IHNjaGVtYUNvbnRyb2xsZXIuZW5mb3JjZUNsYXNzRXhpc3RzKGNsYXNzTmFtZSkpXG4gICAgICAgICAgLnRoZW4oKCkgPT4gc2NoZW1hQ29udHJvbGxlci5yZWxvYWREYXRhKCkpXG4gICAgICAgICAgLnRoZW4oKCkgPT4gc2NoZW1hQ29udHJvbGxlci5nZXRPbmVTY2hlbWEoY2xhc3NOYW1lLCB0cnVlKSlcbiAgICAgICAgICAudGhlbihzY2hlbWEgPT4ge1xuICAgICAgICAgICAgdHJhbnNmb3JtQXV0aERhdGEoY2xhc3NOYW1lLCBvYmplY3QsIHNjaGVtYSk7XG4gICAgICAgICAgICBmbGF0dGVuVXBkYXRlT3BlcmF0b3JzRm9yQ3JlYXRlKG9iamVjdCk7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5hZGFwdGVyLmNyZWF0ZU9iamVjdChcbiAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICBTY2hlbWFDb250cm9sbGVyLmNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEoc2NoZW1hKSxcbiAgICAgICAgICAgICAgb2JqZWN0XG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLnRoZW4ocmVzdWx0ID0+IHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmhhbmRsZVJlbGF0aW9uVXBkYXRlcyhcbiAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICBvYmplY3Qub2JqZWN0SWQsXG4gICAgICAgICAgICAgIG9iamVjdCxcbiAgICAgICAgICAgICAgcmVsYXRpb25VcGRhdGVzXG4gICAgICAgICAgICApLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgICByZXR1cm4gc2FuaXRpemVEYXRhYmFzZVJlc3VsdChvcmlnaW5hbE9iamVjdCwgcmVzdWx0Lm9wc1swXSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcbiAgICAgIH0pO1xuICB9XG5cbiAgY2FuQWRkRmllbGQoXG4gICAgc2NoZW1hOiBTY2hlbWFDb250cm9sbGVyLlNjaGVtYUNvbnRyb2xsZXIsXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0OiBhbnksXG4gICAgYWNsR3JvdXA6IHN0cmluZ1tdXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGNsYXNzU2NoZW1hID0gc2NoZW1hLnNjaGVtYURhdGFbY2xhc3NOYW1lXTtcbiAgICBpZiAoIWNsYXNzU2NoZW1hKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuICAgIGNvbnN0IGZpZWxkcyA9IE9iamVjdC5rZXlzKG9iamVjdCk7XG4gICAgY29uc3Qgc2NoZW1hRmllbGRzID0gT2JqZWN0LmtleXMoY2xhc3NTY2hlbWEuZmllbGRzKTtcbiAgICBjb25zdCBuZXdLZXlzID0gZmllbGRzLmZpbHRlcihmaWVsZCA9PiB7XG4gICAgICAvLyBTa2lwIGZpZWxkcyB0aGF0IGFyZSB1bnNldFxuICAgICAgaWYgKFxuICAgICAgICBvYmplY3RbZmllbGRdICYmXG4gICAgICAgIG9iamVjdFtmaWVsZF0uX19vcCAmJlxuICAgICAgICBvYmplY3RbZmllbGRdLl9fb3AgPT09ICdEZWxldGUnXG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHNjaGVtYUZpZWxkcy5pbmRleE9mKGZpZWxkKSA8IDA7XG4gICAgfSk7XG4gICAgaWYgKG5ld0tleXMubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIHNjaGVtYS52YWxpZGF0ZVBlcm1pc3Npb24oY2xhc3NOYW1lLCBhY2xHcm91cCwgJ2FkZEZpZWxkJyk7XG4gICAgfVxuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIC8vIFdvbid0IGRlbGV0ZSBjb2xsZWN0aW9ucyBpbiB0aGUgc3lzdGVtIG5hbWVzcGFjZVxuICAvKipcbiAgICogRGVsZXRlIGFsbCBjbGFzc2VzIGFuZCBjbGVhcnMgdGhlIHNjaGVtYSBjYWNoZVxuICAgKlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGZhc3Qgc2V0IHRvIHRydWUgaWYgaXQncyBvayB0byBqdXN0IGRlbGV0ZSByb3dzIGFuZCBub3QgaW5kZXhlc1xuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gd2hlbiB0aGUgZGVsZXRpb25zIGNvbXBsZXRlc1xuICAgKi9cbiAgZGVsZXRlRXZlcnl0aGluZyhmYXN0OiBib29sZWFuID0gZmFsc2UpOiBQcm9taXNlPGFueT4ge1xuICAgIHRoaXMuc2NoZW1hUHJvbWlzZSA9IG51bGw7XG4gICAgcmV0dXJuIFByb21pc2UuYWxsKFtcbiAgICAgIHRoaXMuYWRhcHRlci5kZWxldGVBbGxDbGFzc2VzKGZhc3QpLFxuICAgICAgdGhpcy5zY2hlbWFDYWNoZS5jbGVhcigpLFxuICAgIF0pO1xuICB9XG5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgZm9yIGEgbGlzdCBvZiByZWxhdGVkIGlkcyBnaXZlbiBhbiBvd25pbmcgaWQuXG4gIC8vIGNsYXNzTmFtZSBoZXJlIGlzIHRoZSBvd25pbmcgY2xhc3NOYW1lLlxuICByZWxhdGVkSWRzKFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIGtleTogc3RyaW5nLFxuICAgIG93bmluZ0lkOiBzdHJpbmcsXG4gICAgcXVlcnlPcHRpb25zOiBRdWVyeU9wdGlvbnNcbiAgKTogUHJvbWlzZTxBcnJheTxzdHJpbmc+PiB7XG4gICAgY29uc3QgeyBza2lwLCBsaW1pdCwgc29ydCB9ID0gcXVlcnlPcHRpb25zO1xuICAgIGNvbnN0IGZpbmRPcHRpb25zID0ge307XG4gICAgaWYgKHNvcnQgJiYgc29ydC5jcmVhdGVkQXQgJiYgdGhpcy5hZGFwdGVyLmNhblNvcnRPbkpvaW5UYWJsZXMpIHtcbiAgICAgIGZpbmRPcHRpb25zLnNvcnQgPSB7IF9pZDogc29ydC5jcmVhdGVkQXQgfTtcbiAgICAgIGZpbmRPcHRpb25zLmxpbWl0ID0gbGltaXQ7XG4gICAgICBmaW5kT3B0aW9ucy5za2lwID0gc2tpcDtcbiAgICAgIHF1ZXJ5T3B0aW9ucy5za2lwID0gMDtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuYWRhcHRlclxuICAgICAgLmZpbmQoXG4gICAgICAgIGpvaW5UYWJsZU5hbWUoY2xhc3NOYW1lLCBrZXkpLFxuICAgICAgICByZWxhdGlvblNjaGVtYSxcbiAgICAgICAgeyBvd25pbmdJZCB9LFxuICAgICAgICBmaW5kT3B0aW9uc1xuICAgICAgKVxuICAgICAgLnRoZW4ocmVzdWx0cyA9PiByZXN1bHRzLm1hcChyZXN1bHQgPT4gcmVzdWx0LnJlbGF0ZWRJZCkpO1xuICB9XG5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgZm9yIGEgbGlzdCBvZiBvd25pbmcgaWRzIGdpdmVuIHNvbWUgcmVsYXRlZCBpZHMuXG4gIC8vIGNsYXNzTmFtZSBoZXJlIGlzIHRoZSBvd25pbmcgY2xhc3NOYW1lLlxuICBvd25pbmdJZHMoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAga2V5OiBzdHJpbmcsXG4gICAgcmVsYXRlZElkczogc3RyaW5nW11cbiAgKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICAgIHJldHVybiB0aGlzLmFkYXB0ZXJcbiAgICAgIC5maW5kKFxuICAgICAgICBqb2luVGFibGVOYW1lKGNsYXNzTmFtZSwga2V5KSxcbiAgICAgICAgcmVsYXRpb25TY2hlbWEsXG4gICAgICAgIHsgcmVsYXRlZElkOiB7ICRpbjogcmVsYXRlZElkcyB9IH0sXG4gICAgICAgIHt9XG4gICAgICApXG4gICAgICAudGhlbihyZXN1bHRzID0+IHJlc3VsdHMubWFwKHJlc3VsdCA9PiByZXN1bHQub3duaW5nSWQpKTtcbiAgfVxuXG4gIC8vIE1vZGlmaWVzIHF1ZXJ5IHNvIHRoYXQgaXQgbm8gbG9uZ2VyIGhhcyAkaW4gb24gcmVsYXRpb24gZmllbGRzLCBvclxuICAvLyBlcXVhbC10by1wb2ludGVyIGNvbnN0cmFpbnRzIG9uIHJlbGF0aW9uIGZpZWxkcy5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aGVuIHF1ZXJ5IGlzIG11dGF0ZWRcbiAgcmVkdWNlSW5SZWxhdGlvbihjbGFzc05hbWU6IHN0cmluZywgcXVlcnk6IGFueSwgc2NoZW1hOiBhbnkpOiBQcm9taXNlPGFueT4ge1xuICAgIC8vIFNlYXJjaCBmb3IgYW4gaW4tcmVsYXRpb24gb3IgZXF1YWwtdG8tcmVsYXRpb25cbiAgICAvLyBNYWtlIGl0IHNlcXVlbnRpYWwgZm9yIG5vdywgbm90IHN1cmUgb2YgcGFyYWxsZWl6YXRpb24gc2lkZSBlZmZlY3RzXG4gICAgaWYgKHF1ZXJ5Wyckb3InXSkge1xuICAgICAgY29uc3Qgb3JzID0gcXVlcnlbJyRvciddO1xuICAgICAgcmV0dXJuIFByb21pc2UuYWxsKFxuICAgICAgICBvcnMubWFwKChhUXVlcnksIGluZGV4KSA9PiB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMucmVkdWNlSW5SZWxhdGlvbihjbGFzc05hbWUsIGFRdWVyeSwgc2NoZW1hKS50aGVuKFxuICAgICAgICAgICAgYVF1ZXJ5ID0+IHtcbiAgICAgICAgICAgICAgcXVlcnlbJyRvciddW2luZGV4XSA9IGFRdWVyeTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICApO1xuICAgICAgICB9KVxuICAgICAgKS50aGVuKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShxdWVyeSk7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBwcm9taXNlcyA9IE9iamVjdC5rZXlzKHF1ZXJ5KS5tYXAoa2V5ID0+IHtcbiAgICAgIGNvbnN0IHQgPSBzY2hlbWEuZ2V0RXhwZWN0ZWRUeXBlKGNsYXNzTmFtZSwga2V5KTtcbiAgICAgIGlmICghdCB8fCB0LnR5cGUgIT09ICdSZWxhdGlvbicpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShxdWVyeSk7XG4gICAgICB9XG4gICAgICBsZXQgcXVlcmllczogPyhhbnlbXSkgPSBudWxsO1xuICAgICAgaWYgKFxuICAgICAgICBxdWVyeVtrZXldICYmXG4gICAgICAgIChxdWVyeVtrZXldWyckaW4nXSB8fFxuICAgICAgICAgIHF1ZXJ5W2tleV1bJyRuZSddIHx8XG4gICAgICAgICAgcXVlcnlba2V5XVsnJG5pbiddIHx8XG4gICAgICAgICAgcXVlcnlba2V5XS5fX3R5cGUgPT0gJ1BvaW50ZXInKVxuICAgICAgKSB7XG4gICAgICAgIC8vIEJ1aWxkIHRoZSBsaXN0IG9mIHF1ZXJpZXNcbiAgICAgICAgcXVlcmllcyA9IE9iamVjdC5rZXlzKHF1ZXJ5W2tleV0pLm1hcChjb25zdHJhaW50S2V5ID0+IHtcbiAgICAgICAgICBsZXQgcmVsYXRlZElkcztcbiAgICAgICAgICBsZXQgaXNOZWdhdGlvbiA9IGZhbHNlO1xuICAgICAgICAgIGlmIChjb25zdHJhaW50S2V5ID09PSAnb2JqZWN0SWQnKSB7XG4gICAgICAgICAgICByZWxhdGVkSWRzID0gW3F1ZXJ5W2tleV0ub2JqZWN0SWRdO1xuICAgICAgICAgIH0gZWxzZSBpZiAoY29uc3RyYWludEtleSA9PSAnJGluJykge1xuICAgICAgICAgICAgcmVsYXRlZElkcyA9IHF1ZXJ5W2tleV1bJyRpbiddLm1hcChyID0+IHIub2JqZWN0SWQpO1xuICAgICAgICAgIH0gZWxzZSBpZiAoY29uc3RyYWludEtleSA9PSAnJG5pbicpIHtcbiAgICAgICAgICAgIGlzTmVnYXRpb24gPSB0cnVlO1xuICAgICAgICAgICAgcmVsYXRlZElkcyA9IHF1ZXJ5W2tleV1bJyRuaW4nXS5tYXAociA9PiByLm9iamVjdElkKTtcbiAgICAgICAgICB9IGVsc2UgaWYgKGNvbnN0cmFpbnRLZXkgPT0gJyRuZScpIHtcbiAgICAgICAgICAgIGlzTmVnYXRpb24gPSB0cnVlO1xuICAgICAgICAgICAgcmVsYXRlZElkcyA9IFtxdWVyeVtrZXldWyckbmUnXS5vYmplY3RJZF07XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGlzTmVnYXRpb24sXG4gICAgICAgICAgICByZWxhdGVkSWRzLFxuICAgICAgICAgIH07XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcXVlcmllcyA9IFt7IGlzTmVnYXRpb246IGZhbHNlLCByZWxhdGVkSWRzOiBbXSB9XTtcbiAgICAgIH1cblxuICAgICAgLy8gcmVtb3ZlIHRoZSBjdXJyZW50IHF1ZXJ5S2V5IGFzIHdlIGRvbix0IG5lZWQgaXQgYW55bW9yZVxuICAgICAgZGVsZXRlIHF1ZXJ5W2tleV07XG4gICAgICAvLyBleGVjdXRlIGVhY2ggcXVlcnkgaW5kZXBlbmRlbnRseSB0byBidWlsZCB0aGUgbGlzdCBvZlxuICAgICAgLy8gJGluIC8gJG5pblxuICAgICAgY29uc3QgcHJvbWlzZXMgPSBxdWVyaWVzLm1hcChxID0+IHtcbiAgICAgICAgaWYgKCFxKSB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLm93bmluZ0lkcyhjbGFzc05hbWUsIGtleSwgcS5yZWxhdGVkSWRzKS50aGVuKGlkcyA9PiB7XG4gICAgICAgICAgaWYgKHEuaXNOZWdhdGlvbikge1xuICAgICAgICAgICAgdGhpcy5hZGROb3RJbk9iamVjdElkc0lkcyhpZHMsIHF1ZXJ5KTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5hZGRJbk9iamVjdElkc0lkcyhpZHMsIHF1ZXJ5KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgICByZXR1cm4gUHJvbWlzZS5hbGwocHJvbWlzZXMpLnRoZW4oKCkgPT4ge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIHJldHVybiBQcm9taXNlLmFsbChwcm9taXNlcykudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHF1ZXJ5KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIE1vZGlmaWVzIHF1ZXJ5IHNvIHRoYXQgaXQgbm8gbG9uZ2VyIGhhcyAkcmVsYXRlZFRvXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiBxdWVyeSBpcyBtdXRhdGVkXG4gIHJlZHVjZVJlbGF0aW9uS2V5cyhcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBxdWVyeTogYW55LFxuICAgIHF1ZXJ5T3B0aW9uczogYW55XG4gICk6ID9Qcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAocXVlcnlbJyRvciddKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5hbGwoXG4gICAgICAgIHF1ZXJ5Wyckb3InXS5tYXAoYVF1ZXJ5ID0+IHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5yZWR1Y2VSZWxhdGlvbktleXMoY2xhc3NOYW1lLCBhUXVlcnksIHF1ZXJ5T3B0aW9ucyk7XG4gICAgICAgIH0pXG4gICAgICApO1xuICAgIH1cblxuICAgIHZhciByZWxhdGVkVG8gPSBxdWVyeVsnJHJlbGF0ZWRUbyddO1xuICAgIGlmIChyZWxhdGVkVG8pIHtcbiAgICAgIHJldHVybiB0aGlzLnJlbGF0ZWRJZHMoXG4gICAgICAgIHJlbGF0ZWRUby5vYmplY3QuY2xhc3NOYW1lLFxuICAgICAgICByZWxhdGVkVG8ua2V5LFxuICAgICAgICByZWxhdGVkVG8ub2JqZWN0Lm9iamVjdElkLFxuICAgICAgICBxdWVyeU9wdGlvbnNcbiAgICAgIClcbiAgICAgICAgLnRoZW4oaWRzID0+IHtcbiAgICAgICAgICBkZWxldGUgcXVlcnlbJyRyZWxhdGVkVG8nXTtcbiAgICAgICAgICB0aGlzLmFkZEluT2JqZWN0SWRzSWRzKGlkcywgcXVlcnkpO1xuICAgICAgICAgIHJldHVybiB0aGlzLnJlZHVjZVJlbGF0aW9uS2V5cyhjbGFzc05hbWUsIHF1ZXJ5LCBxdWVyeU9wdGlvbnMpO1xuICAgICAgICB9KVxuICAgICAgICAudGhlbigoKSA9PiB7fSk7XG4gICAgfVxuICB9XG5cbiAgYWRkSW5PYmplY3RJZHNJZHMoaWRzOiA/QXJyYXk8c3RyaW5nPiA9IG51bGwsIHF1ZXJ5OiBhbnkpIHtcbiAgICBjb25zdCBpZHNGcm9tU3RyaW5nOiA/QXJyYXk8c3RyaW5nPiA9XG4gICAgICB0eXBlb2YgcXVlcnkub2JqZWN0SWQgPT09ICdzdHJpbmcnID8gW3F1ZXJ5Lm9iamVjdElkXSA6IG51bGw7XG4gICAgY29uc3QgaWRzRnJvbUVxOiA/QXJyYXk8c3RyaW5nPiA9XG4gICAgICBxdWVyeS5vYmplY3RJZCAmJiBxdWVyeS5vYmplY3RJZFsnJGVxJ10gPyBbcXVlcnkub2JqZWN0SWRbJyRlcSddXSA6IG51bGw7XG4gICAgY29uc3QgaWRzRnJvbUluOiA/QXJyYXk8c3RyaW5nPiA9XG4gICAgICBxdWVyeS5vYmplY3RJZCAmJiBxdWVyeS5vYmplY3RJZFsnJGluJ10gPyBxdWVyeS5vYmplY3RJZFsnJGluJ10gOiBudWxsO1xuXG4gICAgLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG4gICAgY29uc3QgYWxsSWRzOiBBcnJheTxBcnJheTxzdHJpbmc+PiA9IFtcbiAgICAgIGlkc0Zyb21TdHJpbmcsXG4gICAgICBpZHNGcm9tRXEsXG4gICAgICBpZHNGcm9tSW4sXG4gICAgICBpZHMsXG4gICAgXS5maWx0ZXIobGlzdCA9PiBsaXN0ICE9PSBudWxsKTtcbiAgICBjb25zdCB0b3RhbExlbmd0aCA9IGFsbElkcy5yZWR1Y2UoKG1lbW8sIGxpc3QpID0+IG1lbW8gKyBsaXN0Lmxlbmd0aCwgMCk7XG5cbiAgICBsZXQgaWRzSW50ZXJzZWN0aW9uID0gW107XG4gICAgaWYgKHRvdGFsTGVuZ3RoID4gMTI1KSB7XG4gICAgICBpZHNJbnRlcnNlY3Rpb24gPSBpbnRlcnNlY3QuYmlnKGFsbElkcyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlkc0ludGVyc2VjdGlvbiA9IGludGVyc2VjdChhbGxJZHMpO1xuICAgIH1cblxuICAgIC8vIE5lZWQgdG8gbWFrZSBzdXJlIHdlIGRvbid0IGNsb2JiZXIgZXhpc3Rpbmcgc2hvcnRoYW5kICRlcSBjb25zdHJhaW50cyBvbiBvYmplY3RJZC5cbiAgICBpZiAoISgnb2JqZWN0SWQnIGluIHF1ZXJ5KSkge1xuICAgICAgcXVlcnkub2JqZWN0SWQgPSB7XG4gICAgICAgICRpbjogdW5kZWZpbmVkLFxuICAgICAgfTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBxdWVyeS5vYmplY3RJZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHF1ZXJ5Lm9iamVjdElkID0ge1xuICAgICAgICAkaW46IHVuZGVmaW5lZCxcbiAgICAgICAgJGVxOiBxdWVyeS5vYmplY3RJZCxcbiAgICAgIH07XG4gICAgfVxuICAgIHF1ZXJ5Lm9iamVjdElkWyckaW4nXSA9IGlkc0ludGVyc2VjdGlvbjtcblxuICAgIHJldHVybiBxdWVyeTtcbiAgfVxuXG4gIGFkZE5vdEluT2JqZWN0SWRzSWRzKGlkczogc3RyaW5nW10gPSBbXSwgcXVlcnk6IGFueSkge1xuICAgIGNvbnN0IGlkc0Zyb21OaW4gPVxuICAgICAgcXVlcnkub2JqZWN0SWQgJiYgcXVlcnkub2JqZWN0SWRbJyRuaW4nXSA/IHF1ZXJ5Lm9iamVjdElkWyckbmluJ10gOiBbXTtcbiAgICBsZXQgYWxsSWRzID0gWy4uLmlkc0Zyb21OaW4sIC4uLmlkc10uZmlsdGVyKGxpc3QgPT4gbGlzdCAhPT0gbnVsbCk7XG5cbiAgICAvLyBtYWtlIGEgc2V0IGFuZCBzcHJlYWQgdG8gcmVtb3ZlIGR1cGxpY2F0ZXNcbiAgICBhbGxJZHMgPSBbLi4ubmV3IFNldChhbGxJZHMpXTtcblxuICAgIC8vIE5lZWQgdG8gbWFrZSBzdXJlIHdlIGRvbid0IGNsb2JiZXIgZXhpc3Rpbmcgc2hvcnRoYW5kICRlcSBjb25zdHJhaW50cyBvbiBvYmplY3RJZC5cbiAgICBpZiAoISgnb2JqZWN0SWQnIGluIHF1ZXJ5KSkge1xuICAgICAgcXVlcnkub2JqZWN0SWQgPSB7XG4gICAgICAgICRuaW46IHVuZGVmaW5lZCxcbiAgICAgIH07XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgcXVlcnkub2JqZWN0SWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICBxdWVyeS5vYmplY3RJZCA9IHtcbiAgICAgICAgJG5pbjogdW5kZWZpbmVkLFxuICAgICAgICAkZXE6IHF1ZXJ5Lm9iamVjdElkLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBxdWVyeS5vYmplY3RJZFsnJG5pbiddID0gYWxsSWRzO1xuICAgIHJldHVybiBxdWVyeTtcbiAgfVxuXG4gIC8vIFJ1bnMgYSBxdWVyeSBvbiB0aGUgZGF0YWJhc2UuXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gYSBsaXN0IG9mIGl0ZW1zLlxuICAvLyBPcHRpb25zOlxuICAvLyAgIHNraXAgICAgbnVtYmVyIG9mIHJlc3VsdHMgdG8gc2tpcC5cbiAgLy8gICBsaW1pdCAgIGxpbWl0IHRvIHRoaXMgbnVtYmVyIG9mIHJlc3VsdHMuXG4gIC8vICAgc29ydCAgICBhbiBvYmplY3Qgd2hlcmUga2V5cyBhcmUgdGhlIGZpZWxkcyB0byBzb3J0IGJ5LlxuICAvLyAgICAgICAgICAgdGhlIHZhbHVlIGlzICsxIGZvciBhc2NlbmRpbmcsIC0xIGZvciBkZXNjZW5kaW5nLlxuICAvLyAgIGNvdW50ICAgcnVuIGEgY291bnQgaW5zdGVhZCBvZiByZXR1cm5pbmcgcmVzdWx0cy5cbiAgLy8gICBhY2wgICAgIHJlc3RyaWN0IHRoaXMgb3BlcmF0aW9uIHdpdGggYW4gQUNMIGZvciB0aGUgcHJvdmlkZWQgYXJyYXlcbiAgLy8gICAgICAgICAgIG9mIHVzZXIgb2JqZWN0SWRzIGFuZCByb2xlcy4gYWNsOiBudWxsIG1lYW5zIG5vIHVzZXIuXG4gIC8vICAgICAgICAgICB3aGVuIHRoaXMgZmllbGQgaXMgbm90IHByZXNlbnQsIGRvbid0IGRvIGFueXRoaW5nIHJlZ2FyZGluZyBBQ0xzLlxuICAvLyBUT0RPOiBtYWtlIHVzZXJJZHMgbm90IG5lZWRlZCBoZXJlLiBUaGUgZGIgYWRhcHRlciBzaG91bGRuJ3Qga25vd1xuICAvLyBhbnl0aGluZyBhYm91dCB1c2VycywgaWRlYWxseS4gVGhlbiwgaW1wcm92ZSB0aGUgZm9ybWF0IG9mIHRoZSBBQ0xcbiAgLy8gYXJnIHRvIHdvcmsgbGlrZSB0aGUgb3RoZXJzLlxuICBmaW5kKFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIHF1ZXJ5OiBhbnksXG4gICAge1xuICAgICAgc2tpcCxcbiAgICAgIGxpbWl0LFxuICAgICAgYWNsLFxuICAgICAgc29ydCA9IHt9LFxuICAgICAgY291bnQsXG4gICAgICBrZXlzLFxuICAgICAgb3AsXG4gICAgICBkaXN0aW5jdCxcbiAgICAgIHBpcGVsaW5lLFxuICAgICAgcmVhZFByZWZlcmVuY2UsXG4gICAgfTogYW55ID0ge30sXG4gICAgYXV0aDogYW55ID0ge31cbiAgKTogUHJvbWlzZTxhbnk+IHtcbiAgICBjb25zdCBpc01hc3RlciA9IGFjbCA9PT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGFjbEdyb3VwID0gYWNsIHx8IFtdO1xuICAgIG9wID1cbiAgICAgIG9wIHx8XG4gICAgICAodHlwZW9mIHF1ZXJ5Lm9iamVjdElkID09ICdzdHJpbmcnICYmIE9iamVjdC5rZXlzKHF1ZXJ5KS5sZW5ndGggPT09IDFcbiAgICAgICAgPyAnZ2V0J1xuICAgICAgICA6ICdmaW5kJyk7XG4gICAgLy8gQ291bnQgb3BlcmF0aW9uIGlmIGNvdW50aW5nXG4gICAgb3AgPSBjb3VudCA9PT0gdHJ1ZSA/ICdjb3VudCcgOiBvcDtcblxuICAgIGxldCBjbGFzc0V4aXN0cyA9IHRydWU7XG4gICAgcmV0dXJuIHRoaXMubG9hZFNjaGVtYSgpLnRoZW4oc2NoZW1hQ29udHJvbGxlciA9PiB7XG4gICAgICAvL0FsbG93IHZvbGF0aWxlIGNsYXNzZXMgaWYgcXVlcnlpbmcgd2l0aCBNYXN0ZXIgKGZvciBfUHVzaFN0YXR1cylcbiAgICAgIC8vVE9ETzogTW92ZSB2b2xhdGlsZSBjbGFzc2VzIGNvbmNlcHQgaW50byBtb25nbyBhZGFwdGVyLCBwb3N0Z3JlcyBhZGFwdGVyIHNob3VsZG4ndCBjYXJlXG4gICAgICAvL3RoYXQgYXBpLnBhcnNlLmNvbSBicmVha3Mgd2hlbiBfUHVzaFN0YXR1cyBleGlzdHMgaW4gbW9uZ28uXG4gICAgICByZXR1cm4gc2NoZW1hQ29udHJvbGxlclxuICAgICAgICAuZ2V0T25lU2NoZW1hKGNsYXNzTmFtZSwgaXNNYXN0ZXIpXG4gICAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgICAgLy8gQmVoYXZpb3IgZm9yIG5vbi1leGlzdGVudCBjbGFzc2VzIGlzIGtpbmRhIHdlaXJkIG9uIFBhcnNlLmNvbS4gUHJvYmFibHkgZG9lc24ndCBtYXR0ZXIgdG9vIG11Y2guXG4gICAgICAgICAgLy8gRm9yIG5vdywgcHJldGVuZCB0aGUgY2xhc3MgZXhpc3RzIGJ1dCBoYXMgbm8gb2JqZWN0cyxcbiAgICAgICAgICBpZiAoZXJyb3IgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY2xhc3NFeGlzdHMgPSBmYWxzZTtcbiAgICAgICAgICAgIHJldHVybiB7IGZpZWxkczoge30gfTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH0pXG4gICAgICAgIC50aGVuKHNjaGVtYSA9PiB7XG4gICAgICAgICAgLy8gUGFyc2UuY29tIHRyZWF0cyBxdWVyaWVzIG9uIF9jcmVhdGVkX2F0IGFuZCBfdXBkYXRlZF9hdCBhcyBpZiB0aGV5IHdlcmUgcXVlcmllcyBvbiBjcmVhdGVkQXQgYW5kIHVwZGF0ZWRBdCxcbiAgICAgICAgICAvLyBzbyBkdXBsaWNhdGUgdGhhdCBiZWhhdmlvciBoZXJlLiBJZiBib3RoIGFyZSBzcGVjaWZpZWQsIHRoZSBjb3JyZWN0IGJlaGF2aW9yIHRvIG1hdGNoIFBhcnNlLmNvbSBpcyB0b1xuICAgICAgICAgIC8vIHVzZSB0aGUgb25lIHRoYXQgYXBwZWFycyBmaXJzdCBpbiB0aGUgc29ydCBsaXN0LlxuICAgICAgICAgIGlmIChzb3J0Ll9jcmVhdGVkX2F0KSB7XG4gICAgICAgICAgICBzb3J0LmNyZWF0ZWRBdCA9IHNvcnQuX2NyZWF0ZWRfYXQ7XG4gICAgICAgICAgICBkZWxldGUgc29ydC5fY3JlYXRlZF9hdDtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHNvcnQuX3VwZGF0ZWRfYXQpIHtcbiAgICAgICAgICAgIHNvcnQudXBkYXRlZEF0ID0gc29ydC5fdXBkYXRlZF9hdDtcbiAgICAgICAgICAgIGRlbGV0ZSBzb3J0Ll91cGRhdGVkX2F0O1xuICAgICAgICAgIH1cbiAgICAgICAgICBjb25zdCBxdWVyeU9wdGlvbnMgPSB7IHNraXAsIGxpbWl0LCBzb3J0LCBrZXlzLCByZWFkUHJlZmVyZW5jZSB9O1xuICAgICAgICAgIE9iamVjdC5rZXlzKHNvcnQpLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICAgICAgICAgIGlmIChmaWVsZE5hbWUubWF0Y2goL15hdXRoRGF0YVxcLihbYS16QS1aMC05X10rKVxcLmlkJC8pKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLFxuICAgICAgICAgICAgICAgIGBDYW5ub3Qgc29ydCBieSAke2ZpZWxkTmFtZX1gXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCByb290RmllbGROYW1lID0gZ2V0Um9vdEZpZWxkTmFtZShmaWVsZE5hbWUpO1xuICAgICAgICAgICAgaWYgKCFTY2hlbWFDb250cm9sbGVyLmZpZWxkTmFtZUlzVmFsaWQocm9vdEZpZWxkTmFtZSkpIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUsXG4gICAgICAgICAgICAgICAgYEludmFsaWQgZmllbGQgbmFtZTogJHtmaWVsZE5hbWV9LmBcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgICByZXR1cm4gKGlzTWFzdGVyXG4gICAgICAgICAgICA/IFByb21pc2UucmVzb2x2ZSgpXG4gICAgICAgICAgICA6IHNjaGVtYUNvbnRyb2xsZXIudmFsaWRhdGVQZXJtaXNzaW9uKGNsYXNzTmFtZSwgYWNsR3JvdXAsIG9wKVxuICAgICAgICAgIClcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHRoaXMucmVkdWNlUmVsYXRpb25LZXlzKGNsYXNzTmFtZSwgcXVlcnksIHF1ZXJ5T3B0aW9ucykpXG4gICAgICAgICAgICAudGhlbigoKSA9PlxuICAgICAgICAgICAgICB0aGlzLnJlZHVjZUluUmVsYXRpb24oY2xhc3NOYW1lLCBxdWVyeSwgc2NoZW1hQ29udHJvbGxlcilcbiAgICAgICAgICAgIClcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgbGV0IHByb3RlY3RlZEZpZWxkcztcbiAgICAgICAgICAgICAgaWYgKCFpc01hc3Rlcikge1xuICAgICAgICAgICAgICAgIHF1ZXJ5ID0gdGhpcy5hZGRQb2ludGVyUGVybWlzc2lvbnMoXG4gICAgICAgICAgICAgICAgICBzY2hlbWFDb250cm9sbGVyLFxuICAgICAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICAgICAgb3AsXG4gICAgICAgICAgICAgICAgICBxdWVyeSxcbiAgICAgICAgICAgICAgICAgIGFjbEdyb3VwXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAvLyBQcm90ZWN0ZWRGaWVsZHMgaXMgZ2VuZXJhdGVkIGJlZm9yZSBleGVjdXRpbmcgdGhlIHF1ZXJ5IHNvIHdlXG4gICAgICAgICAgICAgICAgLy8gY2FuIG9wdGltaXplIHRoZSBxdWVyeSB1c2luZyBNb25nbyBQcm9qZWN0aW9uIGF0IGEgbGF0ZXIgc3RhZ2UuXG4gICAgICAgICAgICAgICAgcHJvdGVjdGVkRmllbGRzID0gdGhpcy5hZGRQcm90ZWN0ZWRGaWVsZHMoXG4gICAgICAgICAgICAgICAgICBzY2hlbWFDb250cm9sbGVyLFxuICAgICAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICAgICAgcXVlcnksXG4gICAgICAgICAgICAgICAgICBhY2xHcm91cCxcbiAgICAgICAgICAgICAgICAgIGF1dGhcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGlmICghcXVlcnkpIHtcbiAgICAgICAgICAgICAgICBpZiAob3AgPT09ICdnZXQnKSB7XG4gICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgICAgICAgIFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsXG4gICAgICAgICAgICAgICAgICAgICdPYmplY3Qgbm90IGZvdW5kLidcbiAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgaWYgKCFpc01hc3Rlcikge1xuICAgICAgICAgICAgICAgIGlmIChvcCA9PT0gJ3VwZGF0ZScgfHwgb3AgPT09ICdkZWxldGUnKSB7XG4gICAgICAgICAgICAgICAgICBxdWVyeSA9IGFkZFdyaXRlQUNMKHF1ZXJ5LCBhY2xHcm91cCk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIHF1ZXJ5ID0gYWRkUmVhZEFDTChxdWVyeSwgYWNsR3JvdXApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB2YWxpZGF0ZVF1ZXJ5KHF1ZXJ5KTtcbiAgICAgICAgICAgICAgaWYgKGNvdW50KSB7XG4gICAgICAgICAgICAgICAgaWYgKCFjbGFzc0V4aXN0cykge1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIDA7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmFkYXB0ZXIuY291bnQoXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgc2NoZW1hLFxuICAgICAgICAgICAgICAgICAgICBxdWVyeSxcbiAgICAgICAgICAgICAgICAgICAgcmVhZFByZWZlcmVuY2VcbiAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9IGVsc2UgaWYgKGRpc3RpbmN0KSB7XG4gICAgICAgICAgICAgICAgaWYgKCFjbGFzc0V4aXN0cykge1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5hZGFwdGVyLmRpc3RpbmN0KFxuICAgICAgICAgICAgICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgICAgICAgICAgICAgIHNjaGVtYSxcbiAgICAgICAgICAgICAgICAgICAgcXVlcnksXG4gICAgICAgICAgICAgICAgICAgIGRpc3RpbmN0XG4gICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChwaXBlbGluZSkge1xuICAgICAgICAgICAgICAgIGlmICghY2xhc3NFeGlzdHMpIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuYWRhcHRlci5hZ2dyZWdhdGUoXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgc2NoZW1hLFxuICAgICAgICAgICAgICAgICAgICBwaXBlbGluZSxcbiAgICAgICAgICAgICAgICAgICAgcmVhZFByZWZlcmVuY2VcbiAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmFkYXB0ZXJcbiAgICAgICAgICAgICAgICAgIC5maW5kKGNsYXNzTmFtZSwgc2NoZW1hLCBxdWVyeSwgcXVlcnlPcHRpb25zKVxuICAgICAgICAgICAgICAgICAgLnRoZW4ob2JqZWN0cyA9PlxuICAgICAgICAgICAgICAgICAgICBvYmplY3RzLm1hcChvYmplY3QgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgIG9iamVjdCA9IHVudHJhbnNmb3JtT2JqZWN0QUNMKG9iamVjdCk7XG4gICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZpbHRlclNlbnNpdGl2ZURhdGEoXG4gICAgICAgICAgICAgICAgICAgICAgICBpc01hc3RlcixcbiAgICAgICAgICAgICAgICAgICAgICAgIGFjbEdyb3VwLFxuICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgcHJvdGVjdGVkRmllbGRzLFxuICAgICAgICAgICAgICAgICAgICAgICAgb2JqZWN0XG4gICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgICAgICAgICBQYXJzZS5FcnJvci5JTlRFUk5BTF9TRVJWRVJfRVJST1IsXG4gICAgICAgICAgICAgICAgICAgICAgZXJyb3JcbiAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBkZWxldGVTY2hlbWEoY2xhc3NOYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gdGhpcy5sb2FkU2NoZW1hKHsgY2xlYXJDYWNoZTogdHJ1ZSB9KVxuICAgICAgLnRoZW4oc2NoZW1hQ29udHJvbGxlciA9PiBzY2hlbWFDb250cm9sbGVyLmdldE9uZVNjaGVtYShjbGFzc05hbWUsIHRydWUpKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICByZXR1cm4geyBmaWVsZHM6IHt9IH07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAudGhlbigoc2NoZW1hOiBhbnkpID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuY29sbGVjdGlvbkV4aXN0cyhjbGFzc05hbWUpXG4gICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5hZGFwdGVyLmNvdW50KGNsYXNzTmFtZSwgeyBmaWVsZHM6IHt9IH0pKVxuICAgICAgICAgIC50aGVuKGNvdW50ID0+IHtcbiAgICAgICAgICAgIGlmIChjb3VudCA+IDApIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICAgIDI1NSxcbiAgICAgICAgICAgICAgICBgQ2xhc3MgJHtjbGFzc05hbWV9IGlzIG5vdCBlbXB0eSwgY29udGFpbnMgJHtjb3VudH0gb2JqZWN0cywgY2Fubm90IGRyb3Agc2NoZW1hLmBcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmFkYXB0ZXIuZGVsZXRlQ2xhc3MoY2xhc3NOYW1lKTtcbiAgICAgICAgICB9KVxuICAgICAgICAgIC50aGVuKHdhc1BhcnNlQ29sbGVjdGlvbiA9PiB7XG4gICAgICAgICAgICBpZiAod2FzUGFyc2VDb2xsZWN0aW9uKSB7XG4gICAgICAgICAgICAgIGNvbnN0IHJlbGF0aW9uRmllbGROYW1lcyA9IE9iamVjdC5rZXlzKHNjaGVtYS5maWVsZHMpLmZpbHRlcihcbiAgICAgICAgICAgICAgICBmaWVsZE5hbWUgPT4gc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdSZWxhdGlvbidcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKFxuICAgICAgICAgICAgICAgIHJlbGF0aW9uRmllbGROYW1lcy5tYXAobmFtZSA9PlxuICAgICAgICAgICAgICAgICAgdGhpcy5hZGFwdGVyLmRlbGV0ZUNsYXNzKGpvaW5UYWJsZU5hbWUoY2xhc3NOYW1lLCBuYW1lKSlcbiAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICkudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgIH0pO1xuICB9XG5cbiAgYWRkUG9pbnRlclBlcm1pc3Npb25zKFxuICAgIHNjaGVtYTogU2NoZW1hQ29udHJvbGxlci5TY2hlbWFDb250cm9sbGVyLFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIG9wZXJhdGlvbjogc3RyaW5nLFxuICAgIHF1ZXJ5OiBhbnksXG4gICAgYWNsR3JvdXA6IGFueVtdID0gW11cbiAgKSB7XG4gICAgLy8gQ2hlY2sgaWYgY2xhc3MgaGFzIHB1YmxpYyBwZXJtaXNzaW9uIGZvciBvcGVyYXRpb25cbiAgICAvLyBJZiB0aGUgQmFzZUNMUCBwYXNzLCBsZXQgZ28gdGhyb3VnaFxuICAgIGlmIChzY2hlbWEudGVzdFBlcm1pc3Npb25zRm9yQ2xhc3NOYW1lKGNsYXNzTmFtZSwgYWNsR3JvdXAsIG9wZXJhdGlvbikpIHtcbiAgICAgIHJldHVybiBxdWVyeTtcbiAgICB9XG4gICAgY29uc3QgcGVybXMgPSBzY2hlbWEuZ2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zKGNsYXNzTmFtZSk7XG4gICAgY29uc3QgZmllbGQgPVxuICAgICAgWydnZXQnLCAnZmluZCddLmluZGV4T2Yob3BlcmF0aW9uKSA+IC0xXG4gICAgICAgID8gJ3JlYWRVc2VyRmllbGRzJ1xuICAgICAgICA6ICd3cml0ZVVzZXJGaWVsZHMnO1xuICAgIGNvbnN0IHVzZXJBQ0wgPSBhY2xHcm91cC5maWx0ZXIoYWNsID0+IHtcbiAgICAgIHJldHVybiBhY2wuaW5kZXhPZigncm9sZTonKSAhPSAwICYmIGFjbCAhPSAnKic7XG4gICAgfSk7XG4gICAgLy8gdGhlIEFDTCBzaG91bGQgaGF2ZSBleGFjdGx5IDEgdXNlclxuICAgIGlmIChwZXJtcyAmJiBwZXJtc1tmaWVsZF0gJiYgcGVybXNbZmllbGRdLmxlbmd0aCA+IDApIHtcbiAgICAgIC8vIE5vIHVzZXIgc2V0IHJldHVybiB1bmRlZmluZWRcbiAgICAgIC8vIElmIHRoZSBsZW5ndGggaXMgPiAxLCB0aGF0IG1lYW5zIHdlIGRpZG4ndCBkZS1kdXBlIHVzZXJzIGNvcnJlY3RseVxuICAgICAgaWYgKHVzZXJBQ0wubGVuZ3RoICE9IDEpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY29uc3QgdXNlcklkID0gdXNlckFDTFswXTtcbiAgICAgIGNvbnN0IHVzZXJQb2ludGVyID0ge1xuICAgICAgICBfX3R5cGU6ICdQb2ludGVyJyxcbiAgICAgICAgY2xhc3NOYW1lOiAnX1VzZXInLFxuICAgICAgICBvYmplY3RJZDogdXNlcklkLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgcGVybUZpZWxkcyA9IHBlcm1zW2ZpZWxkXTtcbiAgICAgIGNvbnN0IG9ycyA9IHBlcm1GaWVsZHMubWFwKGtleSA9PiB7XG4gICAgICAgIGNvbnN0IHEgPSB7XG4gICAgICAgICAgW2tleV06IHVzZXJQb2ludGVyLFxuICAgICAgICB9O1xuICAgICAgICAvLyBpZiB3ZSBhbHJlYWR5IGhhdmUgYSBjb25zdHJhaW50IG9uIHRoZSBrZXksIHVzZSB0aGUgJGFuZFxuICAgICAgICBpZiAocXVlcnkuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICAgIHJldHVybiB7ICRhbmQ6IFtxLCBxdWVyeV0gfTtcbiAgICAgICAgfVxuICAgICAgICAvLyBvdGhlcndpc2UganVzdCBhZGQgdGhlIGNvbnN0YWludFxuICAgICAgICByZXR1cm4gT2JqZWN0LmFzc2lnbih7fSwgcXVlcnksIHtcbiAgICAgICAgICBbYCR7a2V5fWBdOiB1c2VyUG9pbnRlcixcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICAgIGlmIChvcnMubGVuZ3RoID4gMSkge1xuICAgICAgICByZXR1cm4geyAkb3I6IG9ycyB9O1xuICAgICAgfVxuICAgICAgcmV0dXJuIG9yc1swXTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHF1ZXJ5O1xuICAgIH1cbiAgfVxuXG4gIGFkZFByb3RlY3RlZEZpZWxkcyhcbiAgICBzY2hlbWE6IFNjaGVtYUNvbnRyb2xsZXIuU2NoZW1hQ29udHJvbGxlcixcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBxdWVyeTogYW55ID0ge30sXG4gICAgYWNsR3JvdXA6IGFueVtdID0gW10sXG4gICAgYXV0aDogYW55ID0ge31cbiAgKSB7XG4gICAgY29uc3QgcGVybXMgPSBzY2hlbWEuZ2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zKGNsYXNzTmFtZSk7XG4gICAgaWYgKCFwZXJtcykgcmV0dXJuIG51bGw7XG5cbiAgICBjb25zdCBwcm90ZWN0ZWRGaWVsZHMgPSBwZXJtcy5wcm90ZWN0ZWRGaWVsZHM7XG4gICAgaWYgKCFwcm90ZWN0ZWRGaWVsZHMpIHJldHVybiBudWxsO1xuXG4gICAgaWYgKGFjbEdyb3VwLmluZGV4T2YocXVlcnkub2JqZWN0SWQpID4gLTEpIHJldHVybiBudWxsO1xuICAgIGlmIChcbiAgICAgIE9iamVjdC5rZXlzKHF1ZXJ5KS5sZW5ndGggPT09IDAgJiZcbiAgICAgIGF1dGggJiZcbiAgICAgIGF1dGgudXNlciAmJlxuICAgICAgYWNsR3JvdXAuaW5kZXhPZihhdXRoLnVzZXIuaWQpID4gLTFcbiAgICApXG4gICAgICByZXR1cm4gbnVsbDtcblxuICAgIGxldCBwcm90ZWN0ZWRLZXlzID0gT2JqZWN0LnZhbHVlcyhwcm90ZWN0ZWRGaWVsZHMpLnJlZHVjZShcbiAgICAgIChhY2MsIHZhbCkgPT4gYWNjLmNvbmNhdCh2YWwpLFxuICAgICAgW11cbiAgICApOyAvLy5mbGF0KCk7XG4gICAgWy4uLihhdXRoLnVzZXJSb2xlcyB8fCBbXSldLmZvckVhY2gocm9sZSA9PiB7XG4gICAgICBjb25zdCBmaWVsZHMgPSBwcm90ZWN0ZWRGaWVsZHNbcm9sZV07XG4gICAgICBpZiAoZmllbGRzKSB7XG4gICAgICAgIHByb3RlY3RlZEtleXMgPSBwcm90ZWN0ZWRLZXlzLmZpbHRlcih2ID0+IGZpZWxkcy5pbmNsdWRlcyh2KSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gcHJvdGVjdGVkS2V5cztcbiAgfVxuXG4gIC8vIFRPRE86IGNyZWF0ZSBpbmRleGVzIG9uIGZpcnN0IGNyZWF0aW9uIG9mIGEgX1VzZXIgb2JqZWN0LiBPdGhlcndpc2UgaXQncyBpbXBvc3NpYmxlIHRvXG4gIC8vIGhhdmUgYSBQYXJzZSBhcHAgd2l0aG91dCBpdCBoYXZpbmcgYSBfVXNlciBjb2xsZWN0aW9uLlxuICBwZXJmb3JtSW5pdGlhbGl6YXRpb24oKSB7XG4gICAgY29uc3QgcmVxdWlyZWRVc2VyRmllbGRzID0ge1xuICAgICAgZmllbGRzOiB7XG4gICAgICAgIC4uLlNjaGVtYUNvbnRyb2xsZXIuZGVmYXVsdENvbHVtbnMuX0RlZmF1bHQsXG4gICAgICAgIC4uLlNjaGVtYUNvbnRyb2xsZXIuZGVmYXVsdENvbHVtbnMuX1VzZXIsXG4gICAgICB9LFxuICAgIH07XG4gICAgY29uc3QgcmVxdWlyZWRSb2xlRmllbGRzID0ge1xuICAgICAgZmllbGRzOiB7XG4gICAgICAgIC4uLlNjaGVtYUNvbnRyb2xsZXIuZGVmYXVsdENvbHVtbnMuX0RlZmF1bHQsXG4gICAgICAgIC4uLlNjaGVtYUNvbnRyb2xsZXIuZGVmYXVsdENvbHVtbnMuX1JvbGUsXG4gICAgICB9LFxuICAgIH07XG5cbiAgICBjb25zdCB1c2VyQ2xhc3NQcm9taXNlID0gdGhpcy5sb2FkU2NoZW1hKCkudGhlbihzY2hlbWEgPT5cbiAgICAgIHNjaGVtYS5lbmZvcmNlQ2xhc3NFeGlzdHMoJ19Vc2VyJylcbiAgICApO1xuICAgIGNvbnN0IHJvbGVDbGFzc1Byb21pc2UgPSB0aGlzLmxvYWRTY2hlbWEoKS50aGVuKHNjaGVtYSA9PlxuICAgICAgc2NoZW1hLmVuZm9yY2VDbGFzc0V4aXN0cygnX1JvbGUnKVxuICAgICk7XG5cbiAgICBjb25zdCB1c2VybmFtZVVuaXF1ZW5lc3MgPSB1c2VyQ2xhc3NQcm9taXNlXG4gICAgICAudGhlbigoKSA9PlxuICAgICAgICB0aGlzLmFkYXB0ZXIuZW5zdXJlVW5pcXVlbmVzcygnX1VzZXInLCByZXF1aXJlZFVzZXJGaWVsZHMsIFsndXNlcm5hbWUnXSlcbiAgICAgIClcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdVbmFibGUgdG8gZW5zdXJlIHVuaXF1ZW5lc3MgZm9yIHVzZXJuYW1lczogJywgZXJyb3IpO1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH0pO1xuXG4gICAgY29uc3QgZW1haWxVbmlxdWVuZXNzID0gdXNlckNsYXNzUHJvbWlzZVxuICAgICAgLnRoZW4oKCkgPT5cbiAgICAgICAgdGhpcy5hZGFwdGVyLmVuc3VyZVVuaXF1ZW5lc3MoJ19Vc2VyJywgcmVxdWlyZWRVc2VyRmllbGRzLCBbJ2VtYWlsJ10pXG4gICAgICApXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBsb2dnZXIud2FybihcbiAgICAgICAgICAnVW5hYmxlIHRvIGVuc3VyZSB1bmlxdWVuZXNzIGZvciB1c2VyIGVtYWlsIGFkZHJlc3NlczogJyxcbiAgICAgICAgICBlcnJvclxuICAgICAgICApO1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH0pO1xuXG4gICAgY29uc3Qgcm9sZVVuaXF1ZW5lc3MgPSByb2xlQ2xhc3NQcm9taXNlXG4gICAgICAudGhlbigoKSA9PlxuICAgICAgICB0aGlzLmFkYXB0ZXIuZW5zdXJlVW5pcXVlbmVzcygnX1JvbGUnLCByZXF1aXJlZFJvbGVGaWVsZHMsIFsnbmFtZSddKVxuICAgICAgKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ1VuYWJsZSB0byBlbnN1cmUgdW5pcXVlbmVzcyBmb3Igcm9sZSBuYW1lOiAnLCBlcnJvcik7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSk7XG5cbiAgICBjb25zdCBpbmRleFByb21pc2UgPSB0aGlzLmFkYXB0ZXIudXBkYXRlU2NoZW1hV2l0aEluZGV4ZXMoKTtcblxuICAgIC8vIENyZWF0ZSB0YWJsZXMgZm9yIHZvbGF0aWxlIGNsYXNzZXNcbiAgICBjb25zdCBhZGFwdGVySW5pdCA9IHRoaXMuYWRhcHRlci5wZXJmb3JtSW5pdGlhbGl6YXRpb24oe1xuICAgICAgVm9sYXRpbGVDbGFzc2VzU2NoZW1hczogU2NoZW1hQ29udHJvbGxlci5Wb2xhdGlsZUNsYXNzZXNTY2hlbWFzLFxuICAgIH0pO1xuICAgIHJldHVybiBQcm9taXNlLmFsbChbXG4gICAgICB1c2VybmFtZVVuaXF1ZW5lc3MsXG4gICAgICBlbWFpbFVuaXF1ZW5lc3MsXG4gICAgICByb2xlVW5pcXVlbmVzcyxcbiAgICAgIGFkYXB0ZXJJbml0LFxuICAgICAgaW5kZXhQcm9taXNlLFxuICAgIF0pO1xuICB9XG5cbiAgc3RhdGljIF92YWxpZGF0ZVF1ZXJ5OiBhbnkgPT4gdm9pZDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBEYXRhYmFzZUNvbnRyb2xsZXI7XG4vLyBFeHBvc2UgdmFsaWRhdGVRdWVyeSBmb3IgdGVzdHNcbm1vZHVsZS5leHBvcnRzLl92YWxpZGF0ZVF1ZXJ5ID0gdmFsaWRhdGVRdWVyeTtcbiJdfQ==