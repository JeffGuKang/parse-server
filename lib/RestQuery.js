"use strict";

// An object that encapsulates everything we need to run a 'find'
// operation, encoded in the REST API format.
var SchemaController = require('./Controllers/SchemaController');

var Parse = require('parse/node').Parse;

const triggers = require('./triggers');

const {
  continueWhile
} = require('parse/lib/node/promiseUtils');

const AlwaysSelectedKeys = ['objectId', 'createdAt', 'updatedAt', 'ACL']; // restOptions can include:
//   skip
//   limit
//   order
//   count
//   include
//   keys
//   redirectClassNameForKey

function RestQuery(config, auth, className, restWhere = {}, restOptions = {}, clientSDK) {
  this.config = config;
  this.auth = auth;
  this.className = className;
  this.restWhere = restWhere;
  this.restOptions = restOptions;
  this.clientSDK = clientSDK;
  this.response = null;
  this.findOptions = {};

  if (!this.auth.isMaster) {
    if (this.className == '_Session') {
      if (!this.auth.user) {
        throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Invalid session token');
      }

      this.restWhere = {
        $and: [this.restWhere, {
          user: {
            __type: 'Pointer',
            className: '_User',
            objectId: this.auth.user.id
          }
        }]
      };
    }
  }

  this.doCount = false;
  this.includeAll = false; // The format for this.include is not the same as the format for the
  // include option - it's the paths we should include, in order,
  // stored as arrays, taking into account that we need to include foo
  // before including foo.bar. Also it should dedupe.
  // For example, passing an arg of include=foo.bar,foo.baz could lead to
  // this.include = [['foo'], ['foo', 'baz'], ['foo', 'bar']]

  this.include = []; // If we have keys, we probably want to force some includes (n-1 level)
  // See issue: https://github.com/parse-community/parse-server/issues/3185

  if (restOptions.hasOwnProperty('keys')) {
    const keysForInclude = restOptions.keys.split(',').filter(key => {
      // At least 2 components
      return key.split('.').length > 1;
    }).map(key => {
      // Slice the last component (a.b.c -> a.b)
      // Otherwise we'll include one level too much.
      return key.slice(0, key.lastIndexOf('.'));
    }).join(','); // Concat the possibly present include string with the one from the keys
    // Dedup / sorting is handle in 'include' case.

    if (keysForInclude.length > 0) {
      if (!restOptions.include || restOptions.include.length == 0) {
        restOptions.include = keysForInclude;
      } else {
        restOptions.include += ',' + keysForInclude;
      }
    }
  }

  for (var option in restOptions) {
    switch (option) {
      case 'keys':
        {
          const keys = restOptions.keys.split(',').concat(AlwaysSelectedKeys);
          this.keys = Array.from(new Set(keys));
          break;
        }

      case 'count':
        this.doCount = true;
        break;

      case 'includeAll':
        this.includeAll = true;
        break;

      case 'distinct':
      case 'pipeline':
      case 'skip':
      case 'limit':
      case 'readPreference':
        this.findOptions[option] = restOptions[option];
        break;

      case 'order':
        var fields = restOptions.order.split(',');
        this.findOptions.sort = fields.reduce((sortMap, field) => {
          field = field.trim();

          if (field === '$score') {
            sortMap.score = {
              $meta: 'textScore'
            };
          } else if (field[0] == '-') {
            sortMap[field.slice(1)] = -1;
          } else {
            sortMap[field] = 1;
          }

          return sortMap;
        }, {});
        break;

      case 'include':
        {
          const paths = restOptions.include.split(',');

          if (paths.includes('*')) {
            this.includeAll = true;
            break;
          } // Load the existing includes (from keys)


          const pathSet = paths.reduce((memo, path) => {
            // Split each paths on . (a.b.c -> [a,b,c])
            // reduce to create all paths
            // ([a,b,c] -> {a: true, 'a.b': true, 'a.b.c': true})
            return path.split('.').reduce((memo, path, index, parts) => {
              memo[parts.slice(0, index + 1).join('.')] = true;
              return memo;
            }, memo);
          }, {});
          this.include = Object.keys(pathSet).map(s => {
            return s.split('.');
          }).sort((a, b) => {
            return a.length - b.length; // Sort by number of components
          });
          break;
        }

      case 'redirectClassNameForKey':
        this.redirectKey = restOptions.redirectClassNameForKey;
        this.redirectClassName = null;
        break;

      case 'includeReadPreference':
      case 'subqueryReadPreference':
        break;

      default:
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad option: ' + option);
    }
  }
} // A convenient method to perform all the steps of processing a query
// in order.
// Returns a promise for the response - an object with optional keys
// 'results' and 'count'.
// TODO: consolidate the replaceX functions


RestQuery.prototype.execute = function (executeOptions) {
  return Promise.resolve().then(() => {
    return this.buildRestWhere();
  }).then(() => {
    return this.handleIncludeAll();
  }).then(() => {
    return this.runFind(executeOptions);
  }).then(() => {
    return this.runCount();
  }).then(() => {
    return this.handleInclude();
  }).then(() => {
    return this.runAfterFindTrigger();
  }).then(() => {
    return this.response;
  });
};

RestQuery.prototype.each = function (callback) {
  const {
    config,
    auth,
    className,
    restWhere,
    restOptions,
    clientSDK
  } = this; // if the limit is set, use it

  restOptions.limit = restOptions.limit || 100;
  restOptions.order = 'objectId';
  let finished = false;
  return continueWhile(() => {
    return !finished;
  }, async () => {
    const query = new RestQuery(config, auth, className, restWhere, restOptions, clientSDK);
    const {
      results
    } = await query.execute();
    results.forEach(callback);
    finished = results.length < restOptions.limit;

    if (!finished) {
      restWhere.objectId = Object.assign({}, restWhere.objectId, {
        $gt: results[results.length - 1].objectId
      });
    }
  });
};

RestQuery.prototype.buildRestWhere = function () {
  return Promise.resolve().then(() => {
    return this.getUserAndRoleACL();
  }).then(() => {
    return this.redirectClassNameForKey();
  }).then(() => {
    return this.validateClientClassCreation();
  }).then(() => {
    return this.replaceSelect();
  }).then(() => {
    return this.replaceDontSelect();
  }).then(() => {
    return this.replaceInQuery();
  }).then(() => {
    return this.replaceNotInQuery();
  }).then(() => {
    return this.replaceEquality();
  });
}; // Uses the Auth object to get the list of roles, adds the user id


RestQuery.prototype.getUserAndRoleACL = function () {
  if (this.auth.isMaster) {
    return Promise.resolve();
  }

  this.findOptions.acl = ['*'];

  if (this.auth.user) {
    return this.auth.getUserRoles().then(roles => {
      this.findOptions.acl = this.findOptions.acl.concat(roles, [this.auth.user.id]);
      return;
    });
  } else {
    return Promise.resolve();
  }
}; // Changes the className if redirectClassNameForKey is set.
// Returns a promise.


RestQuery.prototype.redirectClassNameForKey = function () {
  if (!this.redirectKey) {
    return Promise.resolve();
  } // We need to change the class name based on the schema


  return this.config.database.redirectClassNameForKey(this.className, this.redirectKey).then(newClassName => {
    this.className = newClassName;
    this.redirectClassName = newClassName;
  });
}; // Validates this operation against the allowClientClassCreation config.


RestQuery.prototype.validateClientClassCreation = function () {
  if (this.config.allowClientClassCreation === false && !this.auth.isMaster && SchemaController.systemClasses.indexOf(this.className) === -1) {
    return this.config.database.loadSchema().then(schemaController => schemaController.hasClass(this.className)).then(hasClass => {
      if (hasClass !== true) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'This user is not allowed to access ' + 'non-existent class: ' + this.className);
      }
    });
  } else {
    return Promise.resolve();
  }
};

function transformInQuery(inQueryObject, className, results) {
  var values = [];

  for (var result of results) {
    values.push({
      __type: 'Pointer',
      className: className,
      objectId: result.objectId
    });
  }

  delete inQueryObject['$inQuery'];

  if (Array.isArray(inQueryObject['$in'])) {
    inQueryObject['$in'] = inQueryObject['$in'].concat(values);
  } else {
    inQueryObject['$in'] = values;
  }
} // Replaces a $inQuery clause by running the subquery, if there is an
// $inQuery clause.
// The $inQuery clause turns into an $in with values that are just
// pointers to the objects returned in the subquery.


RestQuery.prototype.replaceInQuery = function () {
  var inQueryObject = findObjectWithKey(this.restWhere, '$inQuery');

  if (!inQueryObject) {
    return;
  } // The inQuery value must have precisely two keys - where and className


  var inQueryValue = inQueryObject['$inQuery'];

  if (!inQueryValue.where || !inQueryValue.className) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'improper usage of $inQuery');
  }

  const additionalOptions = {
    redirectClassNameForKey: inQueryValue.redirectClassNameForKey
  };

  if (this.restOptions.subqueryReadPreference) {
    additionalOptions.readPreference = this.restOptions.subqueryReadPreference;
    additionalOptions.subqueryReadPreference = this.restOptions.subqueryReadPreference;
  }

  var subquery = new RestQuery(this.config, this.auth, inQueryValue.className, inQueryValue.where, additionalOptions);
  return subquery.execute().then(response => {
    transformInQuery(inQueryObject, subquery.className, response.results); // Recurse to repeat

    return this.replaceInQuery();
  });
};

function transformNotInQuery(notInQueryObject, className, results) {
  var values = [];

  for (var result of results) {
    values.push({
      __type: 'Pointer',
      className: className,
      objectId: result.objectId
    });
  }

  delete notInQueryObject['$notInQuery'];

  if (Array.isArray(notInQueryObject['$nin'])) {
    notInQueryObject['$nin'] = notInQueryObject['$nin'].concat(values);
  } else {
    notInQueryObject['$nin'] = values;
  }
} // Replaces a $notInQuery clause by running the subquery, if there is an
// $notInQuery clause.
// The $notInQuery clause turns into a $nin with values that are just
// pointers to the objects returned in the subquery.


RestQuery.prototype.replaceNotInQuery = function () {
  var notInQueryObject = findObjectWithKey(this.restWhere, '$notInQuery');

  if (!notInQueryObject) {
    return;
  } // The notInQuery value must have precisely two keys - where and className


  var notInQueryValue = notInQueryObject['$notInQuery'];

  if (!notInQueryValue.where || !notInQueryValue.className) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'improper usage of $notInQuery');
  }

  const additionalOptions = {
    redirectClassNameForKey: notInQueryValue.redirectClassNameForKey
  };

  if (this.restOptions.subqueryReadPreference) {
    additionalOptions.readPreference = this.restOptions.subqueryReadPreference;
    additionalOptions.subqueryReadPreference = this.restOptions.subqueryReadPreference;
  }

  var subquery = new RestQuery(this.config, this.auth, notInQueryValue.className, notInQueryValue.where, additionalOptions);
  return subquery.execute().then(response => {
    transformNotInQuery(notInQueryObject, subquery.className, response.results); // Recurse to repeat

    return this.replaceNotInQuery();
  });
};

const transformSelect = (selectObject, key, objects) => {
  var values = [];

  for (var result of objects) {
    values.push(key.split('.').reduce((o, i) => o[i], result));
  }

  delete selectObject['$select'];

  if (Array.isArray(selectObject['$in'])) {
    selectObject['$in'] = selectObject['$in'].concat(values);
  } else {
    selectObject['$in'] = values;
  }
}; // Replaces a $select clause by running the subquery, if there is a
// $select clause.
// The $select clause turns into an $in with values selected out of
// the subquery.
// Returns a possible-promise.


RestQuery.prototype.replaceSelect = function () {
  var selectObject = findObjectWithKey(this.restWhere, '$select');

  if (!selectObject) {
    return;
  } // The select value must have precisely two keys - query and key


  var selectValue = selectObject['$select']; // iOS SDK don't send where if not set, let it pass

  if (!selectValue.query || !selectValue.key || typeof selectValue.query !== 'object' || !selectValue.query.className || Object.keys(selectValue).length !== 2) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'improper usage of $select');
  }

  const additionalOptions = {
    redirectClassNameForKey: selectValue.query.redirectClassNameForKey
  };

  if (this.restOptions.subqueryReadPreference) {
    additionalOptions.readPreference = this.restOptions.subqueryReadPreference;
    additionalOptions.subqueryReadPreference = this.restOptions.subqueryReadPreference;
  }

  var subquery = new RestQuery(this.config, this.auth, selectValue.query.className, selectValue.query.where, additionalOptions);
  return subquery.execute().then(response => {
    transformSelect(selectObject, selectValue.key, response.results); // Keep replacing $select clauses

    return this.replaceSelect();
  });
};

const transformDontSelect = (dontSelectObject, key, objects) => {
  var values = [];

  for (var result of objects) {
    values.push(key.split('.').reduce((o, i) => o[i], result));
  }

  delete dontSelectObject['$dontSelect'];

  if (Array.isArray(dontSelectObject['$nin'])) {
    dontSelectObject['$nin'] = dontSelectObject['$nin'].concat(values);
  } else {
    dontSelectObject['$nin'] = values;
  }
}; // Replaces a $dontSelect clause by running the subquery, if there is a
// $dontSelect clause.
// The $dontSelect clause turns into an $nin with values selected out of
// the subquery.
// Returns a possible-promise.


RestQuery.prototype.replaceDontSelect = function () {
  var dontSelectObject = findObjectWithKey(this.restWhere, '$dontSelect');

  if (!dontSelectObject) {
    return;
  } // The dontSelect value must have precisely two keys - query and key


  var dontSelectValue = dontSelectObject['$dontSelect'];

  if (!dontSelectValue.query || !dontSelectValue.key || typeof dontSelectValue.query !== 'object' || !dontSelectValue.query.className || Object.keys(dontSelectValue).length !== 2) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'improper usage of $dontSelect');
  }

  const additionalOptions = {
    redirectClassNameForKey: dontSelectValue.query.redirectClassNameForKey
  };

  if (this.restOptions.subqueryReadPreference) {
    additionalOptions.readPreference = this.restOptions.subqueryReadPreference;
    additionalOptions.subqueryReadPreference = this.restOptions.subqueryReadPreference;
  }

  var subquery = new RestQuery(this.config, this.auth, dontSelectValue.query.className, dontSelectValue.query.where, additionalOptions);
  return subquery.execute().then(response => {
    transformDontSelect(dontSelectObject, dontSelectValue.key, response.results); // Keep replacing $dontSelect clauses

    return this.replaceDontSelect();
  });
};

const cleanResultAuthData = function (result) {
  delete result.password;

  if (result.authData) {
    Object.keys(result.authData).forEach(provider => {
      if (result.authData[provider] === null) {
        delete result.authData[provider];
      }
    });

    if (Object.keys(result.authData).length == 0) {
      delete result.authData;
    }
  }
};

const replaceEqualityConstraint = constraint => {
  if (typeof constraint !== 'object') {
    return constraint;
  }

  const equalToObject = {};
  let hasDirectConstraint = false;
  let hasOperatorConstraint = false;

  for (const key in constraint) {
    if (key.indexOf('$') !== 0) {
      hasDirectConstraint = true;
      equalToObject[key] = constraint[key];
    } else {
      hasOperatorConstraint = true;
    }
  }

  if (hasDirectConstraint && hasOperatorConstraint) {
    constraint['$eq'] = equalToObject;
    Object.keys(equalToObject).forEach(key => {
      delete constraint[key];
    });
  }

  return constraint;
};

RestQuery.prototype.replaceEquality = function () {
  if (typeof this.restWhere !== 'object') {
    return;
  }

  for (const key in this.restWhere) {
    this.restWhere[key] = replaceEqualityConstraint(this.restWhere[key]);
  }
}; // Returns a promise for whether it was successful.
// Populates this.response with an object that only has 'results'.


RestQuery.prototype.runFind = function (options = {}) {
  if (this.findOptions.limit === 0) {
    this.response = {
      results: []
    };
    return Promise.resolve();
  }

  const findOptions = Object.assign({}, this.findOptions);

  if (this.keys) {
    findOptions.keys = this.keys.map(key => {
      return key.split('.')[0];
    });
  }

  if (options.op) {
    findOptions.op = options.op;
  }

  return this.config.database.find(this.className, this.restWhere, findOptions, this.auth).then(results => {
    if (this.className === '_User') {
      for (var result of results) {
        cleanResultAuthData(result);
      }
    }

    this.config.filesController.expandFilesInObject(this.config, results);

    if (this.redirectClassName) {
      for (var r of results) {
        r.className = this.redirectClassName;
      }
    }

    this.response = {
      results: results
    };
  });
}; // Returns a promise for whether it was successful.
// Populates this.response.count with the count


RestQuery.prototype.runCount = function () {
  if (!this.doCount) {
    return;
  }

  this.findOptions.count = true;
  delete this.findOptions.skip;
  delete this.findOptions.limit;
  return this.config.database.find(this.className, this.restWhere, this.findOptions).then(c => {
    this.response.count = c;
  });
}; // Augments this.response with all pointers on an object


RestQuery.prototype.handleIncludeAll = function () {
  if (!this.includeAll) {
    return;
  }

  return this.config.database.loadSchema().then(schemaController => schemaController.getOneSchema(this.className)).then(schema => {
    const includeFields = [];
    const keyFields = [];

    for (const field in schema.fields) {
      if (schema.fields[field].type && schema.fields[field].type === 'Pointer') {
        includeFields.push([field]);
        keyFields.push(field);
      }
    } // Add fields to include, keys, remove dups


    this.include = [...new Set([...this.include, ...includeFields])]; // if this.keys not set, then all keys are already included

    if (this.keys) {
      this.keys = [...new Set([...this.keys, ...keyFields])];
    }
  });
}; // Augments this.response with data at the paths provided in this.include.


RestQuery.prototype.handleInclude = function () {
  if (this.include.length == 0) {
    return;
  }

  var pathResponse = includePath(this.config, this.auth, this.response, this.include[0], this.restOptions);

  if (pathResponse.then) {
    return pathResponse.then(newResponse => {
      this.response = newResponse;
      this.include = this.include.slice(1);
      return this.handleInclude();
    });
  } else if (this.include.length > 0) {
    this.include = this.include.slice(1);
    return this.handleInclude();
  }

  return pathResponse;
}; //Returns a promise of a processed set of results


RestQuery.prototype.runAfterFindTrigger = function () {
  if (!this.response) {
    return;
  } // Avoid doing any setup for triggers if there is no 'afterFind' trigger for this class.


  const hasAfterFindHook = triggers.triggerExists(this.className, triggers.Types.afterFind, this.config.applicationId);

  if (!hasAfterFindHook) {
    return Promise.resolve();
  } // Skip Aggregate and Distinct Queries


  if (this.findOptions.pipeline || this.findOptions.distinct) {
    return Promise.resolve();
  } // Run afterFind trigger and set the new results


  return triggers.maybeRunAfterFindTrigger(triggers.Types.afterFind, this.auth, this.className, this.response.results, this.config).then(results => {
    // Ensure we properly set the className back
    if (this.redirectClassName) {
      this.response.results = results.map(object => {
        if (object instanceof Parse.Object) {
          object = object.toJSON();
        }

        object.className = this.redirectClassName;
        return object;
      });
    } else {
      this.response.results = results;
    }
  });
}; // Adds included values to the response.
// Path is a list of field names.
// Returns a promise for an augmented response.


function includePath(config, auth, response, path, restOptions = {}) {
  var pointers = findPointers(response.results, path);

  if (pointers.length == 0) {
    return response;
  }

  const pointersHash = {};

  for (var pointer of pointers) {
    if (!pointer) {
      continue;
    }

    const className = pointer.className; // only include the good pointers

    if (className) {
      pointersHash[className] = pointersHash[className] || new Set();
      pointersHash[className].add(pointer.objectId);
    }
  }

  const includeRestOptions = {};

  if (restOptions.keys) {
    const keys = new Set(restOptions.keys.split(','));
    const keySet = Array.from(keys).reduce((set, key) => {
      const keyPath = key.split('.');
      let i = 0;

      for (i; i < path.length; i++) {
        if (path[i] != keyPath[i]) {
          return set;
        }
      }

      if (i < keyPath.length) {
        set.add(keyPath[i]);
      }

      return set;
    }, new Set());

    if (keySet.size > 0) {
      includeRestOptions.keys = Array.from(keySet).join(',');
    }
  }

  if (restOptions.includeReadPreference) {
    includeRestOptions.readPreference = restOptions.includeReadPreference;
    includeRestOptions.includeReadPreference = restOptions.includeReadPreference;
  }

  const queryPromises = Object.keys(pointersHash).map(className => {
    const objectIds = Array.from(pointersHash[className]);
    let where;

    if (objectIds.length === 1) {
      where = {
        objectId: objectIds[0]
      };
    } else {
      where = {
        objectId: {
          $in: objectIds
        }
      };
    }

    var query = new RestQuery(config, auth, className, where, includeRestOptions);
    return query.execute({
      op: 'get'
    }).then(results => {
      results.className = className;
      return Promise.resolve(results);
    });
  }); // Get the objects for all these object ids

  return Promise.all(queryPromises).then(responses => {
    var replace = responses.reduce((replace, includeResponse) => {
      for (var obj of includeResponse.results) {
        obj.__type = 'Object';
        obj.className = includeResponse.className;

        if (obj.className == '_User' && !auth.isMaster) {
          delete obj.sessionToken;
          delete obj.authData;
        }

        replace[obj.objectId] = obj;
      }

      return replace;
    }, {});
    var resp = {
      results: replacePointers(response.results, path, replace)
    };

    if (response.count) {
      resp.count = response.count;
    }

    return resp;
  });
} // Object may be a list of REST-format object to find pointers in, or
// it may be a single object.
// If the path yields things that aren't pointers, this throws an error.
// Path is a list of fields to search into.
// Returns a list of pointers in REST format.


function findPointers(object, path) {
  if (object instanceof Array) {
    var answer = [];

    for (var x of object) {
      answer = answer.concat(findPointers(x, path));
    }

    return answer;
  }

  if (typeof object !== 'object' || !object) {
    return [];
  }

  if (path.length == 0) {
    if (object === null || object.__type == 'Pointer') {
      return [object];
    }

    return [];
  }

  var subobject = object[path[0]];

  if (!subobject) {
    return [];
  }

  return findPointers(subobject, path.slice(1));
} // Object may be a list of REST-format objects to replace pointers
// in, or it may be a single object.
// Path is a list of fields to search into.
// replace is a map from object id -> object.
// Returns something analogous to object, but with the appropriate
// pointers inflated.


function replacePointers(object, path, replace) {
  if (object instanceof Array) {
    return object.map(obj => replacePointers(obj, path, replace)).filter(obj => typeof obj !== 'undefined');
  }

  if (typeof object !== 'object' || !object) {
    return object;
  }

  if (path.length === 0) {
    if (object && object.__type === 'Pointer') {
      return replace[object.objectId];
    }

    return object;
  }

  var subobject = object[path[0]];

  if (!subobject) {
    return object;
  }

  var newsub = replacePointers(subobject, path.slice(1), replace);
  var answer = {};

  for (var key in object) {
    if (key == path[0]) {
      answer[key] = newsub;
    } else {
      answer[key] = object[key];
    }
  }

  return answer;
} // Finds a subobject that has the given key, if there is one.
// Returns undefined otherwise.


function findObjectWithKey(root, key) {
  if (typeof root !== 'object') {
    return;
  }

  if (root instanceof Array) {
    for (var item of root) {
      const answer = findObjectWithKey(item, key);

      if (answer) {
        return answer;
      }
    }
  }

  if (root && root[key]) {
    return root;
  }

  for (var subkey in root) {
    const answer = findObjectWithKey(root[subkey], key);

    if (answer) {
      return answer;
    }
  }
}

module.exports = RestQuery;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9SZXN0UXVlcnkuanMiXSwibmFtZXMiOlsiU2NoZW1hQ29udHJvbGxlciIsInJlcXVpcmUiLCJQYXJzZSIsInRyaWdnZXJzIiwiY29udGludWVXaGlsZSIsIkFsd2F5c1NlbGVjdGVkS2V5cyIsIlJlc3RRdWVyeSIsImNvbmZpZyIsImF1dGgiLCJjbGFzc05hbWUiLCJyZXN0V2hlcmUiLCJyZXN0T3B0aW9ucyIsImNsaWVudFNESyIsInJlc3BvbnNlIiwiZmluZE9wdGlvbnMiLCJpc01hc3RlciIsInVzZXIiLCJFcnJvciIsIklOVkFMSURfU0VTU0lPTl9UT0tFTiIsIiRhbmQiLCJfX3R5cGUiLCJvYmplY3RJZCIsImlkIiwiZG9Db3VudCIsImluY2x1ZGVBbGwiLCJpbmNsdWRlIiwiaGFzT3duUHJvcGVydHkiLCJrZXlzRm9ySW5jbHVkZSIsImtleXMiLCJzcGxpdCIsImZpbHRlciIsImtleSIsImxlbmd0aCIsIm1hcCIsInNsaWNlIiwibGFzdEluZGV4T2YiLCJqb2luIiwib3B0aW9uIiwiY29uY2F0IiwiQXJyYXkiLCJmcm9tIiwiU2V0IiwiZmllbGRzIiwib3JkZXIiLCJzb3J0IiwicmVkdWNlIiwic29ydE1hcCIsImZpZWxkIiwidHJpbSIsInNjb3JlIiwiJG1ldGEiLCJwYXRocyIsImluY2x1ZGVzIiwicGF0aFNldCIsIm1lbW8iLCJwYXRoIiwiaW5kZXgiLCJwYXJ0cyIsIk9iamVjdCIsInMiLCJhIiwiYiIsInJlZGlyZWN0S2V5IiwicmVkaXJlY3RDbGFzc05hbWVGb3JLZXkiLCJyZWRpcmVjdENsYXNzTmFtZSIsIklOVkFMSURfSlNPTiIsInByb3RvdHlwZSIsImV4ZWN1dGUiLCJleGVjdXRlT3B0aW9ucyIsIlByb21pc2UiLCJyZXNvbHZlIiwidGhlbiIsImJ1aWxkUmVzdFdoZXJlIiwiaGFuZGxlSW5jbHVkZUFsbCIsInJ1bkZpbmQiLCJydW5Db3VudCIsImhhbmRsZUluY2x1ZGUiLCJydW5BZnRlckZpbmRUcmlnZ2VyIiwiZWFjaCIsImNhbGxiYWNrIiwibGltaXQiLCJmaW5pc2hlZCIsInF1ZXJ5IiwicmVzdWx0cyIsImZvckVhY2giLCJhc3NpZ24iLCIkZ3QiLCJnZXRVc2VyQW5kUm9sZUFDTCIsInZhbGlkYXRlQ2xpZW50Q2xhc3NDcmVhdGlvbiIsInJlcGxhY2VTZWxlY3QiLCJyZXBsYWNlRG9udFNlbGVjdCIsInJlcGxhY2VJblF1ZXJ5IiwicmVwbGFjZU5vdEluUXVlcnkiLCJyZXBsYWNlRXF1YWxpdHkiLCJhY2wiLCJnZXRVc2VyUm9sZXMiLCJyb2xlcyIsImRhdGFiYXNlIiwibmV3Q2xhc3NOYW1lIiwiYWxsb3dDbGllbnRDbGFzc0NyZWF0aW9uIiwic3lzdGVtQ2xhc3NlcyIsImluZGV4T2YiLCJsb2FkU2NoZW1hIiwic2NoZW1hQ29udHJvbGxlciIsImhhc0NsYXNzIiwiT1BFUkFUSU9OX0ZPUkJJRERFTiIsInRyYW5zZm9ybUluUXVlcnkiLCJpblF1ZXJ5T2JqZWN0IiwidmFsdWVzIiwicmVzdWx0IiwicHVzaCIsImlzQXJyYXkiLCJmaW5kT2JqZWN0V2l0aEtleSIsImluUXVlcnlWYWx1ZSIsIndoZXJlIiwiSU5WQUxJRF9RVUVSWSIsImFkZGl0aW9uYWxPcHRpb25zIiwic3VicXVlcnlSZWFkUHJlZmVyZW5jZSIsInJlYWRQcmVmZXJlbmNlIiwic3VicXVlcnkiLCJ0cmFuc2Zvcm1Ob3RJblF1ZXJ5Iiwibm90SW5RdWVyeU9iamVjdCIsIm5vdEluUXVlcnlWYWx1ZSIsInRyYW5zZm9ybVNlbGVjdCIsInNlbGVjdE9iamVjdCIsIm9iamVjdHMiLCJvIiwiaSIsInNlbGVjdFZhbHVlIiwidHJhbnNmb3JtRG9udFNlbGVjdCIsImRvbnRTZWxlY3RPYmplY3QiLCJkb250U2VsZWN0VmFsdWUiLCJjbGVhblJlc3VsdEF1dGhEYXRhIiwicGFzc3dvcmQiLCJhdXRoRGF0YSIsInByb3ZpZGVyIiwicmVwbGFjZUVxdWFsaXR5Q29uc3RyYWludCIsImNvbnN0cmFpbnQiLCJlcXVhbFRvT2JqZWN0IiwiaGFzRGlyZWN0Q29uc3RyYWludCIsImhhc09wZXJhdG9yQ29uc3RyYWludCIsIm9wdGlvbnMiLCJvcCIsImZpbmQiLCJmaWxlc0NvbnRyb2xsZXIiLCJleHBhbmRGaWxlc0luT2JqZWN0IiwiciIsImNvdW50Iiwic2tpcCIsImMiLCJnZXRPbmVTY2hlbWEiLCJzY2hlbWEiLCJpbmNsdWRlRmllbGRzIiwia2V5RmllbGRzIiwidHlwZSIsInBhdGhSZXNwb25zZSIsImluY2x1ZGVQYXRoIiwibmV3UmVzcG9uc2UiLCJoYXNBZnRlckZpbmRIb29rIiwidHJpZ2dlckV4aXN0cyIsIlR5cGVzIiwiYWZ0ZXJGaW5kIiwiYXBwbGljYXRpb25JZCIsInBpcGVsaW5lIiwiZGlzdGluY3QiLCJtYXliZVJ1bkFmdGVyRmluZFRyaWdnZXIiLCJvYmplY3QiLCJ0b0pTT04iLCJwb2ludGVycyIsImZpbmRQb2ludGVycyIsInBvaW50ZXJzSGFzaCIsInBvaW50ZXIiLCJhZGQiLCJpbmNsdWRlUmVzdE9wdGlvbnMiLCJrZXlTZXQiLCJzZXQiLCJrZXlQYXRoIiwic2l6ZSIsImluY2x1ZGVSZWFkUHJlZmVyZW5jZSIsInF1ZXJ5UHJvbWlzZXMiLCJvYmplY3RJZHMiLCIkaW4iLCJhbGwiLCJyZXNwb25zZXMiLCJyZXBsYWNlIiwiaW5jbHVkZVJlc3BvbnNlIiwib2JqIiwic2Vzc2lvblRva2VuIiwicmVzcCIsInJlcGxhY2VQb2ludGVycyIsImFuc3dlciIsIngiLCJzdWJvYmplY3QiLCJuZXdzdWIiLCJyb290IiwiaXRlbSIsInN1YmtleSIsIm1vZHVsZSIsImV4cG9ydHMiXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUVBLElBQUlBLGdCQUFnQixHQUFHQyxPQUFPLENBQUMsZ0NBQUQsQ0FBOUI7O0FBQ0EsSUFBSUMsS0FBSyxHQUFHRCxPQUFPLENBQUMsWUFBRCxDQUFQLENBQXNCQyxLQUFsQzs7QUFDQSxNQUFNQyxRQUFRLEdBQUdGLE9BQU8sQ0FBQyxZQUFELENBQXhCOztBQUNBLE1BQU07QUFBRUcsRUFBQUE7QUFBRixJQUFvQkgs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dUksTUFBaEIsRUFBd0I7QUFDdEIsUUFBSXZJLEdBQUcsSUFBSXdCLElBQUksQ0FBQyxDQUFELENBQWYsRUFBb0I7QUFDbEJ1SSxNQUFBQSxNQUFNLENBQUMvSixHQUFELENBQU4sR0FBY2tLLE1BQWQ7QUFDRCxLQUZELE1BRU87QUFDTEgsTUFBQUEsTUFBTSxDQUFDL0osR0FBRCxDQUFOLEdBQWN1SSxNQUFNLENBQUN2SSxHQUFELENBQXBCO0FBQ0Q7QUFDRjs7QUFDRCxTQUFPK0osTUFBUDtBQUNELEMsQ0FFRDtBQUNBOzs7QUFDQSxTQUFTOUUsaUJBQVQsQ0FBMkJrRixJQUEzQixFQUFpQ25LLEdBQWpDLEVBQXNDO0FBQ3BDLE1BQUksT0FBT21LLElBQVAsS0FBZ0IsUUFBcEIsRUFBOEI7QUFDNUI7QUFDRDs7QUFDRCxNQUFJQSxJQUFJLFlBQVkzSixLQUFwQixFQUEyQjtBQUN6QixTQUFLLElBQUk0SixJQUFULElBQWlCRCxJQUFqQixFQUF1QjtBQUNyQixZQUFNSixNQUFNLEdBQUc5RSxpQkFBaUIsQ0FBQ21GLElBQUQsRUFBT3BLLEdBQVAsQ0FBaEM7O0FBQ0EsVUFBSStKLE1BQUosRUFBWTtBQUNWLGVBQU9BLE1BQVA7QUFDRDtBQUNGO0FBQ0Y7O0FBQ0QsTUFBSUksSUFBSSxJQUFJQSxJQUFJLENBQUNuSyxHQUFELENBQWhCLEVBQXVCO0FBQ3JCLFdBQU9tSyxJQUFQO0FBQ0Q7O0FBQ0QsT0FBSyxJQUFJRSxNQUFULElBQW1CRixJQUFuQixFQUF5QjtBQUN2QixVQUFNSixNQUFNLEdBQUc5RSxpQkFBaUIsQ0FBQ2tGLElBQUksQ0FBQ0UsTUFBRCxDQUFMLEVBQWVySyxHQUFmLENBQWhDOztBQUNBLFFBQUkrSixNQUFKLEVBQVk7QUFDVixhQUFPQSxNQUFQO0FBQ0Q7QUFDRjtBQUNGOztBQUVETyxNQUFNLENBQUNDLE9BQVAsR0FBaUJoTSxTQUFqQiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEFuIG9iamVjdCB0aGF0IGVuY2Fwc3VsYXRlcyBldmVyeXRoaW5nIHdlIG5lZWQgdG8gcnVuIGEgJ2ZpbmQnXG4vLyBvcGVyYXRpb24sIGVuY29kZWQgaW4gdGhlIFJFU1QgQVBJIGZvcm1hdC5cblxudmFyIFNjaGVtYUNvbnRyb2xsZXIgPSByZXF1aXJlKCcuL0NvbnRyb2xsZXJzL1NjaGVtYUNvbnRyb2xsZXInKTtcbnZhciBQYXJzZSA9IHJlcXVpcmUoJ3BhcnNlL25vZGUnKS5QYXJzZTtcbmNvbnN0IHRyaWdnZXJzID0gcmVxdWlyZSgnLi90cmlnZ2VycycpO1xuY29uc3QgeyBjb250aW51ZVdoaWxlIH0gPSByZXF1aXJlKCdwYXJzZS9saWIvbm9kZS9wcm9taXNlVXRpbHMnKTtcbmNvbnN0IEFsd2F5c1NlbGVjdGVkS2V5cyA9IFsnb2JqZWN0SWQnLCAnY3JlYXRlZEF0JywgJ3VwZGF0ZWRBdCcsICdBQ0wnXTtcbi8vIHJlc3RPcHRpb25zIGNhbiBpbmNsdWRlOlxuLy8gICBza2lwXG4vLyAgIGxpbWl0XG4vLyAgIG9yZGVyXG4vLyAgIGNvdW50XG4vLyAgIGluY2x1ZGVcbi8vICAga2V5c1xuLy8gICByZWRpcmVjdENsYXNzTmFtZUZvcktleVxuZnVuY3Rpb24gUmVzdFF1ZXJ5KFxuICBjb25maWcsXG4gIGF1dGgsXG4gIGNsYXNzTmFtZSxcbiAgcmVzdFdoZXJlID0ge30sXG4gIHJlc3RPcHRpb25zID0ge30sXG4gIGNsaWVudFNES1xuKSB7XG4gIHRoaXMuY29uZmlnID0gY29uZmlnO1xuICB0aGlzLmF1dGggPSBhdXRoO1xuICB0aGlzLmNsYXNzTmFtZSA9IGNsYXNzTmFtZTtcbiAgdGhpcy5yZXN0V2hlcmUgPSByZXN0V2hlcmU7XG4gIHRoaXMucmVzdE9wdGlvbnMgPSByZXN0T3B0aW9ucztcbiAgdGhpcy5jbGllbnRTREsgPSBjbGllbnRTREs7XG4gIHRoaXMucmVzcG9uc2UgPSBudWxsO1xuICB0aGlzLmZpbmRPcHRpb25zID0ge307XG5cbiAgaWYgKCF0aGlzLmF1dGguaXNNYXN0ZXIpIHtcbiAgICBpZiAodGhpcy5jbGFzc05hbWUgPT0gJ19TZXNzaW9uJykge1xuICAgICAgaWYgKCF0aGlzLmF1dGgudXNlcikge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9TRVNTSU9OX1RPS0VOLFxuICAgICAgICAgICdJbnZhbGlkIHNlc3Npb24gdG9rZW4nXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICB0aGlzLnJlc3RXaGVyZSA9IHtcbiAgICAgICAgJGFuZDogW1xuICAgICAgICAgIHRoaXMucmVzdFdoZXJlLFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHVzZXI6IHtcbiAgICAgICAgICAgICAgX190eXBlOiAnUG9pbnRlcicsXG4gICAgICAgICAgICAgIGNsYXNzTmFtZTogJ19Vc2VyJyxcbiAgICAgICAgICAgICAgb2JqZWN0SWQ6IHRoaXMuYXV0aC51c2VyLmlkLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICB0aGlzLmRvQ291bnQgPSBmYWxzZTtcbiAgdGhpcy5pbmNsdWRlQWxsID0gZmFsc2U7XG5cbiAgLy8gVGhlIGZvcm1hdCBmb3IgdGhpcy5pbmNsdWRlIGlzIG5vdCB0aGUgc2FtZSBhcyB0aGUgZm9ybWF0IGZvciB0aGVcbiAgLy8gaW5jbHVkZSBvcHRpb24gLSBpdCdzIHRoZSBwYXRocyB3ZSBzaG91bGQgaW5jbHVkZSwgaW4gb3JkZXIsXG4gIC8vIHN0b3JlZCBhcyBhcnJheXMsIHRha2luZyBpbnRvIGFjY291bnQgdGhhdCB3ZSBuZWVkIHRvIGluY2x1ZGUgZm9vXG4gIC8vIGJlZm9yZSBpbmNsdWRpbmcgZm9vLmJhci4gQWxzbyBpdCBzaG91bGQgZGVkdXBlLlxuICAvLyBGb3IgZXhhbXBsZSwgcGFzc2luZyBhbiBhcmcgb2YgaW5jbHVkZT1mb28uYmFyLGZvby5iYXogY291bGQgbGVhZCB0b1xuICAvLyB0aGlzLmluY2x1ZGUgPSBbWydmb28nXSwgWydmb28nLCAnYmF6J10sIFsnZm9vJywgJ2JhciddXVxuICB0aGlzLmluY2x1ZGUgPSBbXTtcblxuICAvLyBJZiB3ZSBoYXZlIGtleXMsIHdlIHByb2JhYmx5IHdhbnQgdG8gZm9yY2Ugc29tZSBpbmNsdWRlcyAobi0xIGxldmVsKVxuICAvLyBTZWUgaXNzdWU6IGh0dHBzOi8vZ2l0aHViLmNvbS9wYXJzZS1jb21tdW5pdHkvcGFyc2Utc2VydmVyL2lzc3Vlcy8zMTg1XG4gIGlmIChyZXN0T3B0aW9ucy5oYXNPd25Qcm9wZXJ0eSgna2V5cycpKSB7XG4gICAgY29uc3Qga2V5c0ZvckluY2x1ZGUgPSByZXN0T3B0aW9ucy5rZXlzXG4gICAgICAuc3BsaXQoJywnKVxuICAgICAgLmZpbHRlcihrZXkgPT4ge1xuICAgICAgICAvLyBBdCBsZWFzdCAyIGNvbXBvbmVudHNcbiAgICAgICAgcmV0dXJuIGtleS5zcGxpdCgnLicpLmxlbmd0aCA+IDE7XG4gICAgICB9KVxuICAgICAgLm1hcChrZXkgPT4ge1xuICAgICAgICAvLyBTbGljZSB0aGUgbGFzdCBjb21wb25lbnQgKGEuYi5jIC0+IGEuYilcbiAgICAgICAgLy8gT3RoZXJ3aXNlIHdlJ2xsIGluY2x1ZGUgb25lIGxldmVsIHRvbyBtdWNoLlxuICAgICAgICByZXR1cm4ga2V5LnNsaWNlKDAsIGtleS5sYXN0SW5kZXhPZignLicpKTtcbiAgICAgIH0pXG4gICAgICAuam9pbignLCcpO1xuXG4gICAgLy8gQ29uY2F0IHRoZSBwb3NzaWJseSBwcmVzZW50IGluY2x1ZGUgc3RyaW5nIHdpdGggdGhlIG9uZSBmcm9tIHRoZSBrZXlzXG4gICAgLy8gRGVkdXAgLyBzb3J0aW5nIGlzIGhhbmRsZSBpbiAnaW5jbHVkZScgY2FzZS5cbiAgICBpZiAoa2V5c0ZvckluY2x1ZGUubGVuZ3RoID4gMCkge1xuICAgICAgaWYgKCFyZXN0T3B0aW9ucy5pbmNsdWRlIHx8IHJlc3RPcHRpb25zLmluY2x1ZGUubGVuZ3RoID09IDApIHtcbiAgICAgICAgcmVzdE9wdGlvbnMuaW5jbHVkZSA9IGtleXNGb3JJbmNsdWRlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmVzdE9wdGlvbnMuaW5jbHVkZSArPSAnLCcgKyBrZXlzRm9ySW5jbHVkZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBmb3IgKHZhciBvcHRpb24gaW4gcmVzdE9wdGlvbnMpIHtcbiAgICBzd2l0Y2ggKG9wdGlvbikge1xuICAgICAgY2FzZSAna2V5cyc6IHtcbiAgICAgICAgY29uc3Qga2V5cyA9IHJlc3RPcHRpb25zLmtleXMuc3BsaXQoJywnKS5jb25jYXQoQWx3YXlzU2VsZWN0ZWRLZXlzKTtcbiAgICAgICAgdGhpcy5rZXlzID0gQXJyYXkuZnJvbShuZXcgU2V0KGtleXMpKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBjYXNlICdjb3VudCc6XG4gICAgICAgIHRoaXMuZG9Db3VudCA9IHRydWU7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnaW5jbHVkZUFsbCc6XG4gICAgICAgIHRoaXMuaW5jbHVkZUFsbCA9IHRydWU7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnZGlzdGluY3QnOlxuICAgICAgY2FzZSAncGlwZWxpbmUnOlxuICAgICAgY2FzZSAnc2tpcCc6XG4gICAgICBjYXNlICdsaW1pdCc6XG4gICAgICBjYXNlICdyZWFkUHJlZmVyZW5jZSc6XG4gICAgICAgIHRoaXMuZmluZE9wdGlvbnNbb3B0aW9uXSA9IHJlc3RPcHRpb25zW29wdGlvbl07XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnb3JkZXInOlxuICAgICAgICB2YXIgZmllbGRzID0gcmVzdE9wdGlvbnMub3JkZXIuc3BsaXQoJywnKTtcbiAgICAgICAgdGhpcy5maW5kT3B0aW9ucy5zb3J0ID0gZmllbGRzLnJlZHVjZSgoc29ydE1hcCwgZmllbGQpID0+IHtcbiAgICAgICAgICBmaWVsZCA9IGZpZWxkLnRyaW0oKTtcbiAgICAgICAgICBpZiAoZmllbGQgPT09ICckc2NvcmUnKSB7XG4gICAgICAgICAgICBzb3J0TWFwLnNjb3JlID0geyAkbWV0YTogJ3RleHRTY29yZScgfTtcbiAgICAgICAgICB9IGVsc2UgaWYgKGZpZWxkWzBdID09ICctJykge1xuICAgICAgICAgICAgc29ydE1hcFtmaWVsZC5zbGljZSgxKV0gPSAtMTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgc29ydE1hcFtmaWVsZF0gPSAxO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gc29ydE1hcDtcbiAgICAgICAgfSwge30pO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2luY2x1ZGUnOiB7XG4gICAgICAgIGNvbnN0IHBhdGhzID0gcmVzdE9wdGlvbnMuaW5jbHVkZS5zcGxpdCgnLCcpO1xuICAgICAgICBpZiAocGF0aHMuaW5jbHVkZXMoJyonKSkge1xuICAgICAgICAgIHRoaXMuaW5jbHVkZUFsbCA9IHRydWU7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgLy8gTG9hZCB0aGUgZXhpc3RpbmcgaW5jbHVkZXMgKGZyb20ga2V5cylcbiAgICAgICAgY29uc3QgcGF0aFNldCA9IHBhdGhzLnJlZHVjZSgobWVtbywgcGF0aCkgPT4ge1xuICAgICAgICAgIC8vIFNwbGl0IGVhY2ggcGF0aHMgb24gLiAoYS5iLmMgLT4gW2EsYixjXSlcbiAgICAgICAgICAvLyByZWR1Y2UgdG8gY3JlYXRlIGFsbCBwYXRoc1xuICAgICAgICAgIC8vIChbYSxiLGNdIC0+IHthOiB0cnVlLCAnYS5iJzogdHJ1ZSwgJ2EuYi5jJzogdHJ1ZX0pXG4gICAgICAgICAgcmV0dXJuIHBhdGguc3BsaXQoJy4nKS5yZWR1Y2UoKG1lbW8sIHBhdGgsIGluZGV4LCBwYXJ0cykgPT4ge1xuICAgICAgICAgICAgbWVtb1twYXJ0cy5zbGljZSgwLCBpbmRleCArIDEpLmpvaW4oJy4nKV0gPSB0cnVlO1xuICAgICAgICAgICAgcmV0dXJuIG1lbW87XG4gICAgICAgICAgfSwgbWVtbyk7XG4gICAgICAgIH0sIHt9KTtcblxuICAgICAgICB0aGlzLmluY2x1ZGUgPSBPYmplY3Qua2V5cyhwYXRoU2V0KVxuICAgICAgICAgIC5tYXAocyA9PiB7XG4gICAgICAgICAgICByZXR1cm4gcy5zcGxpdCgnLicpO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLnNvcnQoKGEsIGIpID0+IHtcbiAgICAgICAgICAgIHJldHVybiBhLmxlbmd0aCAtIGIubGVuZ3RoOyAvLyBTb3J0IGJ5IG51bWJlciBvZiBjb21wb25lbnRzXG4gICAgICAgICAgfSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgY2FzZSAncmVkaXJlY3RDbGFzc05hbWVGb3JLZXknOlxuICAgICAgICB0aGlzLnJlZGlyZWN0S2V5ID0gcmVzdE9wdGlvbnMucmVkaXJlY3RDbGFzc05hbWVGb3JLZXk7XG4gICAgICAgIHRoaXMucmVkaXJlY3RDbGFzc05hbWUgPSBudWxsO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2luY2x1ZGVSZWFkUHJlZmVyZW5jZSc6XG4gICAgICBjYXNlICdzdWJxdWVyeVJlYWRQcmVmZXJlbmNlJzpcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICdiYWQgb3B0aW9uOiAnICsgb3B0aW9uXG4gICAgICAgICk7XG4gICAgfVxuICB9XG59XG5cbi8vIEEgY29udmVuaWVudCBtZXRob2QgdG8gcGVyZm9ybSBhbGwgdGhlIHN0ZXBzIG9mIHByb2Nlc3NpbmcgYSBxdWVyeVxuLy8gaW4gb3JkZXIuXG4vLyBSZXR1cm5zIGEgcHJvbWlzZSBmb3IgdGhlIHJlc3BvbnNlIC0gYW4gb2JqZWN0IHdpdGggb3B0aW9uYWwga2V5c1xuLy8gJ3Jlc3VsdHMnIGFuZCAnY291bnQnLlxuLy8gVE9ETzogY29uc29saWRhdGUgdGhlIHJlcGxhY2VYIGZ1bmN0aW9uc1xuUmVzdFF1ZXJ5LnByb3RvdHlwZS5leGVjdXRlID0gZnVuY3Rpb24oZXhlY3V0ZU9wdGlvbnMpIHtcbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuYnVpbGRSZXN0V2hlcmUoKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmhhbmRsZUluY2x1ZGVBbGwoKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLnJ1bkZpbmQoZXhlY3V0ZU9wdGlvbnMpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMucnVuQ291bnQoKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmhhbmRsZUluY2x1ZGUoKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLnJ1bkFmdGVyRmluZFRyaWdnZXIoKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLnJlc3BvbnNlO1xuICAgIH0pO1xufTtcblxuUmVzdFF1ZXJ5LnByb3RvdHlwZS5lYWNoID0gZnVuY3Rpb24oY2FsbGJhY2spIHtcbiAgY29uc3QgeyBjb25maWcsIGF1dGgsIGNsYXNzTmFtZSwgcmVzdFdoZXJlLCByZXN0T3B0aW9ucywgY2xpZW50U0RLIH0gPSB0aGlzO1xuICAvLyBpZiB0aGUgbGltaXQgaXMgc2V0LCB1c2UgaXRcbiAgcmVzdE9wdGlvbnMubGltaXQgPSByZXN0T3B0aW9ucy5saW1pdCB8fCAxMDA7XG4gIHJlc3RPcHRpb25zLm9yZGVyID0gJ29iamVjdElkJztcbiAgbGV0IGZpbmlzaGVkID0gZmFsc2U7XG5cbiAgcmV0dXJuIGNvbnRpbnVlV2hpbGUoXG4gICAgKCkgPT4ge1xuICAgICAgcmV0dXJuICFmaW5pc2hlZDtcbiAgICB9LFxuICAgIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gbmV3IFJlc3RRdWVyeShcbiAgICAgICAgY29uZmlnLFxuICAgICAgICBhdXRoLFxuICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgIHJlc3RXaGVyZSxcbiAgICAgICAgcmVzdE9wdGlvbnMsXG4gICAgICAgIGNsaWVudFNES1xuICAgICAgKTtcbiAgICAgIGNvbnN0IHsgcmVzdWx0cyB9ID0gYXdhaXQgcXVlcnkuZXhlY3V0ZSgpO1xuICAgICAgcmVzdWx0cy5mb3JFYWNoKGNhbGxiYWNrKTtcbiAgICAgIGZpbmlzaGVkID0gcmVzdWx0cy5sZW5ndGggPCByZXN0T3B0aW9ucy5saW1pdDtcbiAgICAgIGlmICghZmluaXNoZWQpIHtcbiAgICAgICAgcmVzdFdoZXJlLm9iamVjdElkID0gT2JqZWN0LmFzc2lnbih7fSwgcmVzdFdoZXJlLm9iamVjdElkLCB7XG4gICAgICAgICAgJGd0OiByZXN1bHRzW3Jlc3VsdHMubGVuZ3RoIC0gMV0ub2JqZWN0SWQsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgKTtcbn07XG5cblJlc3RRdWVyeS5wcm90b3R5cGUuYnVpbGRSZXN0V2hlcmUgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuZ2V0VXNlckFuZFJvbGVBQ0woKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLnJlZGlyZWN0Q2xhc3NOYW1lRm9yS2V5KCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy52YWxpZGF0ZUNsaWVudENsYXNzQ3JlYXRpb24oKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLnJlcGxhY2VTZWxlY3QoKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLnJlcGxhY2VEb250U2VsZWN0KCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5yZXBsYWNlSW5RdWVyeSgpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMucmVwbGFjZU5vdEluUXVlcnkoKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLnJlcGxhY2VFcXVhbGl0eSgpO1xuICAgIH0pO1xufTtcblxuLy8gVXNlcyB0aGUgQXV0aCBvYmplY3QgdG8gZ2V0IHRoZSBsaXN0IG9mIHJvbGVzLCBhZGRzIHRoZSB1c2VyIGlkXG5SZXN0UXVlcnkucHJvdG90eXBlLmdldFVzZXJBbmRSb2xlQUNMID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLmF1dGguaXNNYXN0ZXIpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICB0aGlzLmZpbmRPcHRpb25zLmFjbCA9IFsnKiddO1xuXG4gIGlmICh0aGlzLmF1dGgudXNlcikge1xuICAgIHJldHVybiB0aGlzLmF1dGguZ2V0VXNlclJvbGVzKCkudGhlbihyb2xlcyA9PiB7XG4gICAgICB0aGlzLmZpbmRPcHRpb25zLmFjbCA9IHRoaXMuZmluZE9wdGlvbnMuYWNsLmNvbmNhdChyb2xlcywgW1xuICAgICAgICB0aGlzLmF1dGgudXNlci5pZCxcbiAgICAgIF0pO1xuICAgICAgcmV0dXJuO1xuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxufTtcblxuLy8gQ2hhbmdlcyB0aGUgY2xhc3NOYW1lIGlmIHJlZGlyZWN0Q2xhc3NOYW1lRm9yS2V5IGlzIHNldC5cbi8vIFJldHVybnMgYSBwcm9taXNlLlxuUmVzdFF1ZXJ5LnByb3RvdHlwZS5yZWRpcmVjdENsYXNzTmFtZUZvcktleSA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMucmVkaXJlY3RLZXkpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICAvLyBXZSBuZWVkIHRvIGNoYW5nZSB0aGUgY2xhc3MgbmFtZSBiYXNlZCBvbiB0aGUgc2NoZW1hXG4gIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZVxuICAgIC5yZWRpcmVjdENsYXNzTmFtZUZvcktleSh0aGlzLmNsYXNzTmFtZSwgdGhpcy5yZWRpcmVjdEtleSlcbiAgICAudGhlbihuZXdDbGFzc05hbWUgPT4ge1xuICAgICAgdGhpcy5jbGFzc05hbWUgPSBuZXdDbGFzc05hbWU7XG4gICAgICB0aGlzLnJlZGlyZWN0Q2xhc3NOYW1lID0gbmV3Q2xhc3NOYW1lO1xuICAgIH0pO1xufTtcblxuLy8gVmFsaWRhdGVzIHRoaXMgb3BlcmF0aW9uIGFnYWluc3QgdGhlIGFsbG93Q2xpZW50Q2xhc3NDcmVhdGlvbiBjb25maWcuXG5SZXN0UXVlcnkucHJvdG90eXBlLnZhbGlkYXRlQ2xpZW50Q2xhc3NDcmVhdGlvbiA9IGZ1bmN0aW9uKCkge1xuICBpZiAoXG4gICAgdGhpcy5jb25maWcuYWxsb3dDbGllbnRDbGFzc0NyZWF0aW9uID09PSBmYWxzZSAmJlxuICAgICF0aGlzLmF1dGguaXNNYXN0ZXIgJiZcbiAgICBTY2hlbWFDb250cm9sbGVyLnN5c3RlbUNsYXNzZXMuaW5kZXhPZih0aGlzLmNsYXNzTmFtZSkgPT09IC0xXG4gICkge1xuICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZVxuICAgICAgLmxvYWRTY2hlbWEoKVxuICAgICAgLnRoZW4oc2NoZW1hQ29udHJvbGxlciA9PiBzY2hlbWFDb250cm9sbGVyLmhhc0NsYXNzKHRoaXMuY2xhc3NOYW1lKSlcbiAgICAgIC50aGVuKGhhc0NsYXNzID0+IHtcbiAgICAgICAgaWYgKGhhc0NsYXNzICE9PSB0cnVlKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgICAgICAgICdUaGlzIHVzZXIgaXMgbm90IGFsbG93ZWQgdG8gYWNjZXNzICcgK1xuICAgICAgICAgICAgICAnbm9uLWV4aXN0ZW50IGNsYXNzOiAnICtcbiAgICAgICAgICAgICAgdGhpcy5jbGFzc05hbWVcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cbn07XG5cbmZ1bmN0aW9uIHRyYW5zZm9ybUluUXVlcnkoaW5RdWVyeU9iamVjdCwgY2xhc3NOYW1lLCByZXN1bHRzKSB7XG4gIHZhciB2YWx1ZXMgPSBbXTtcbiAgZm9yICh2YXIgcmVzdWx0IG9mIHJlc3VsdHMpIHtcbiAgICB2YWx1ZXMucHVzaCh7XG4gICAgICBfX3R5cGU6ICdQb2ludGVyJyxcbiAgICAgIGNsYXNzTmFtZTogY2xhc3NOYW1lLFxuICAgICAgb2JqZWN0SWQ6IHJlc3VsdC5vYmplY3RJZCxcbiAgICB9KTtcbiAgfVxuICBkZWxldGUgaW5RdWVyeU9iamVjdFsnJGluUXVlcnknXTtcbiAgaWYgKEFycmF5LmlzQXJyYXkoaW5RdWVyeU9iamVjdFsnJGluJ10pKSB7XG4gICAgaW5RdWVyeU9iamVjdFsnJGluJ10gPSBpblF1ZXJ5T2JqZWN0WyckaW4nXS5jb25jYXQodmFsdWVzKTtcbiAgfSBlbHNlIHtcbiAgICBpblF1ZXJ5T2JqZWN0WyckaW4nXSA9IHZhbHVlcztcbiAgfVxufVxuXG4vLyBSZXBsYWNlcyBhICRpblF1ZXJ5IGNsYXVzZSBieSBydW5uaW5nIHRoZSBzdWJxdWVyeSwgaWYgdGhlcmUgaXMgYW5cbi8vICRpblF1ZXJ5IGNsYXVzZS5cbi8vIFRoZSAkaW5RdWVyeSBjbGF1c2UgdHVybnMgaW50byBhbiAkaW4gd2l0aCB2YWx1ZXMgdGhhdCBhcmUganVzdFxuLy8gcG9pbnRlcnMgdG8gdGhlIG9iamVjdHMgcmV0dXJuZWQgaW4gdGhlIHN1YnF1ZXJ5LlxuUmVzdFF1ZXJ5LnByb3RvdHlwZS5yZXBsYWNlSW5RdWVyeSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgaW5RdWVyeU9iamVjdCA9IGZpbmRPYmplY3RXaXRoS2V5KHRoaXMucmVzdFdoZXJlLCAnJGluUXVlcnknKTtcbiAgaWYgKCFpblF1ZXJ5T2JqZWN0KSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gVGhlIGluUXVlcnkgdmFsdWUgbXVzdCBoYXZlIHByZWNpc2VseSB0d28ga2V5cyAtIHdoZXJlIGFuZCBjbGFzc05hbWVcbiAgdmFyIGluUXVlcnlWYWx1ZSA9IGluUXVlcnlPYmplY3RbJyRpblF1ZXJ5J107XG4gIGlmICghaW5RdWVyeVZhbHVlLndoZXJlIHx8ICFpblF1ZXJ5VmFsdWUuY2xhc3NOYW1lKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSxcbiAgICAgICdpbXByb3BlciB1c2FnZSBvZiAkaW5RdWVyeSdcbiAgICApO1xuICB9XG5cbiAgY29uc3QgYWRkaXRpb25hbE9wdGlvbnMgPSB7XG4gICAgcmVkaXJlY3RDbGFzc05hbWVGb3JLZXk6IGluUXVlcnlWYWx1ZS5yZWRpcmVjdENsYXNzTmFtZUZvcktleSxcbiAgfTtcblxuICBpZiAodGhpcy5yZXN0T3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlKSB7XG4gICAgYWRkaXRpb25hbE9wdGlvbnMucmVhZFByZWZlcmVuY2UgPSB0aGlzLnJlc3RPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2U7XG4gICAgYWRkaXRpb25hbE9wdGlvbnMuc3VicXVlcnlSZWFkUHJlZmVyZW5jZSA9IHRoaXMucmVzdE9wdGlvbnMuc3VicXVlcnlSZWFkUHJlZmVyZW5jZTtcbiAgfVxuXG4gIHZhciBzdWJxdWVyeSA9IG5ldyBSZXN0UXVlcnkoXG4gICAgdGhpcy5jb25maWcsXG4gICAgdGhpcy5hdXRoLFxuICAgIGluUXVlcnlWYWx1ZS5jbGFzc05hbWUsXG4gICAgaW5RdWVyeVZhbHVlLndoZXJlLFxuICAgIGFkZGl0aW9uYWxPcHRpb25zXG4gICk7XG4gIHJldHVybiBzdWJxdWVyeS5leGVjdXRlKCkudGhlbihyZXNwb25zZSA9PiB7XG4gICAgdHJhbnNmb3JtSW5RdWVyeShpblF1ZXJ5T2JqZWN0LCBzdWJxdWVyeS5jbGFzc05hbWUsIHJlc3BvbnNlLnJlc3VsdHMpO1xuICAgIC8vIFJlY3Vyc2UgdG8gcmVwZWF0XG4gICAgcmV0dXJuIHRoaXMucmVwbGFjZUluUXVlcnkoKTtcbiAgfSk7XG59O1xuXG5mdW5jdGlvbiB0cmFuc2Zvcm1Ob3RJblF1ZXJ5KG5vdEluUXVlcnlPYmplY3QsIGNsYXNzTmFtZSwgcmVzdWx0cykge1xuICB2YXIgdmFsdWVzID0gW107XG4gIGZvciAodmFyIHJlc3VsdCBvZiByZXN1bHRzKSB7XG4gICAgdmFsdWVzLnB1c2goe1xuICAgICAgX190eXBlOiAnUG9pbnRlcicsXG4gICAgICBjbGFzc05hbWU6IGNsYXNzTmFtZSxcbiAgICAgIG9iamVjdElkOiByZXN1bHQub2JqZWN0SWQsXG4gICAgfSk7XG4gIH1cbiAgZGVsZXRlIG5vdEluUXVlcnlPYmplY3RbJyRub3RJblF1ZXJ5J107XG4gIGlmIChBcnJheS5pc0FycmF5KG5vdEluUXVlcnlPYmplY3RbJyRuaW4nXSkpIHtcbiAgICBub3RJblF1ZXJ5T2JqZWN0WyckbmluJ10gPSBub3RJblF1ZXJ5T2JqZWN0WyckbmluJ10uY29uY2F0KHZhbHVlcyk7XG4gIH0gZWxzZSB7XG4gICAgbm90SW5RdWVyeU9iamVjdFsnJG5pbiddID0gdmFsdWVzO1xuICB9XG59XG5cbi8vIFJlcGxhY2VzIGEgJG5vdEluUXVlcnkgY2xhdXNlIGJ5IHJ1bm5pbmcgdGhlIHN1YnF1ZXJ5LCBpZiB0aGVyZSBpcyBhblxuLy8gJG5vdEluUXVlcnkgY2xhdXNlLlxuLy8gVGhlICRub3RJblF1ZXJ5IGNsYXVzZSB0dXJucyBpbnRvIGEgJG5pbiB3aXRoIHZhbHVlcyB0aGF0IGFyZSBqdXN0XG4vLyBwb2ludGVycyB0byB0aGUgb2JqZWN0cyByZXR1cm5lZCBpbiB0aGUgc3VicXVlcnkuXG5SZXN0UXVlcnkucHJvdG90eXBlLnJlcGxhY2VOb3RJblF1ZXJ5ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBub3RJblF1ZXJ5T2JqZWN0ID0gZmluZE9iamVjdFdpdGhLZXkodGhpcy5yZXN0V2hlcmUsICckbm90SW5RdWVyeScpO1xuICBpZiAoIW5vdEluUXVlcnlPYmplY3QpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBUaGUgbm90SW5RdWVyeSB2YWx1ZSBtdXN0IGhhdmUgcHJlY2lzZWx5IHR3byBrZXlzIC0gd2hlcmUgYW5kIGNsYXNzTmFtZVxuICB2YXIgbm90SW5RdWVyeVZhbHVlID0gbm90SW5RdWVyeU9iamVjdFsnJG5vdEluUXVlcnknXTtcbiAgaWYgKCFub3RJblF1ZXJ5VmFsdWUud2hlcmUgfHwgIW5vdEluUXVlcnlWYWx1ZS5jbGFzc05hbWUpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICBQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLFxuICAgICAgJ2ltcHJvcGVyIHVzYWdlIG9mICRub3RJblF1ZXJ5J1xuICAgICk7XG4gIH1cblxuICBjb25zdCBhZGRpdGlvbmFsT3B0aW9ucyA9IHtcbiAgICByZWRpcmVjdENsYXNzTmFtZUZvcktleTogbm90SW5RdWVyeVZhbHVlLnJlZGlyZWN0Q2xhc3NOYW1lRm9yS2V5LFxuICB9O1xuXG4gIGlmICh0aGlzLnJlc3RPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2UpIHtcbiAgICBhZGRpdGlvbmFsT3B0aW9ucy5yZWFkUHJlZmVyZW5jZSA9IHRoaXMucmVzdE9wdGlvbnMuc3VicXVlcnlSZWFkUHJlZmVyZW5jZTtcbiAgICBhZGRpdGlvbmFsT3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlID0gdGhpcy5yZXN0T3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlO1xuICB9XG5cbiAgdmFyIHN1YnF1ZXJ5ID0gbmV3IFJlc3RRdWVyeShcbiAgICB0aGlzLmNvbmZpZyxcbiAgICB0aGlzLmF1dGgsXG4gICAgbm90SW5RdWVyeVZhbHVlLmNsYXNzTmFtZSxcbiAgICBub3RJblF1ZXJ5VmFsdWUud2hlcmUsXG4gICAgYWRkaXRpb25hbE9wdGlvbnNcbiAgKTtcbiAgcmV0dXJuIHN1YnF1ZXJ5LmV4ZWN1dGUoKS50aGVuKHJlc3BvbnNlID0+IHtcbiAgICB0cmFuc2Zvcm1Ob3RJblF1ZXJ5KG5vdEluUXVlcnlPYmplY3QsIHN1YnF1ZXJ5LmNsYXNzTmFtZSwgcmVzcG9uc2UucmVzdWx0cyk7XG4gICAgLy8gUmVjdXJzZSB0byByZXBlYXRcbiAgICByZXR1cm4gdGhpcy5yZXBsYWNlTm90SW5RdWVyeSgpO1xuICB9KTtcbn07XG5cbmNvbnN0IHRyYW5zZm9ybVNlbGVjdCA9IChzZWxlY3RPYmplY3QsIGtleSwgb2JqZWN0cykgPT4ge1xuICB2YXIgdmFsdWVzID0gW107XG4gIGZvciAodmFyIHJlc3VsdCBvZiBvYmplY3RzKSB7XG4gICAgdmFsdWVzLnB1c2goa2V5LnNwbGl0KCcuJykucmVkdWNlKChvLCBpKSA9PiBvW2ldLCByZXN1bHQpKTtcbiAgfVxuICBkZWxldGUgc2VsZWN0T2JqZWN0Wyckc2VsZWN0J107XG4gIGlmIChBcnJheS5pc0FycmF5KHNlbGVjdE9iamVjdFsnJGluJ10pKSB7XG4gICAgc2VsZWN0T2JqZWN0WyckaW4nXSA9IHNlbGVjdE9iamVjdFsnJGluJ10uY29uY2F0KHZhbHVlcyk7XG4gIH0gZWxzZSB7XG4gICAgc2VsZWN0T2JqZWN0WyckaW4nXSA9IHZhbHVlcztcbiAgfVxufTtcblxuLy8gUmVwbGFjZXMgYSAkc2VsZWN0IGNsYXVzZSBieSBydW5uaW5nIHRoZSBzdWJxdWVyeSwgaWYgdGhlcmUgaXMgYVxuLy8gJHNlbGVjdCBjbGF1c2UuXG4vLyBUaGUgJHNlbGVjdCBjbGF1c2UgdHVybnMgaW50byBhbiAkaW4gd2l0aCB2YWx1ZXMgc2VsZWN0ZWQgb3V0IG9mXG4vLyB0aGUgc3VicXVlcnkuXG4vLyBSZXR1cm5zIGEgcG9zc2libGUtcHJvbWlzZS5cblJlc3RRdWVyeS5wcm90b3R5cGUucmVwbGFjZVNlbGVjdCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgc2VsZWN0T2JqZWN0ID0gZmluZE9iamVjdFdpdGhLZXkodGhpcy5yZXN0V2hlcmUsICckc2VsZWN0Jyk7XG4gIGlmICghc2VsZWN0T2JqZWN0KSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gVGhlIHNlbGVjdCB2YWx1ZSBtdXN0IGhhdmUgcHJlY2lzZWx5IHR3byBrZXlzIC0gcXVlcnkgYW5kIGtleVxuICB2YXIgc2VsZWN0VmFsdWUgPSBzZWxlY3RPYmplY3RbJyRzZWxlY3QnXTtcbiAgLy8gaU9TIFNESyBkb24ndCBzZW5kIHdoZXJlIGlmIG5vdCBzZXQsIGxldCBpdCBwYXNzXG4gIGlmIChcbiAgICAhc2VsZWN0VmFsdWUucXVlcnkgfHxcbiAgICAhc2VsZWN0VmFsdWUua2V5IHx8XG4gICAgdHlwZW9mIHNlbGVjdFZhbHVlLnF1ZXJ5ICE9PSAnb2JqZWN0JyB8fFxuICAgICFzZWxlY3RWYWx1ZS5xdWVyeS5jbGFzc05hbWUgfHxcbiAgICBPYmplY3Qua2V5cyhzZWxlY3RWYWx1ZSkubGVuZ3RoICE9PSAyXG4gICkge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksXG4gICAgICAnaW1wcm9wZXIgdXNhZ2Ugb2YgJHNlbGVjdCdcbiAgICApO1xuICB9XG5cbiAgY29uc3QgYWRkaXRpb25hbE9wdGlvbnMgPSB7XG4gICAgcmVkaXJlY3RDbGFzc05hbWVGb3JLZXk6IHNlbGVjdFZhbHVlLnF1ZXJ5LnJlZGlyZWN0Q2xhc3NOYW1lRm9yS2V5LFxuICB9O1xuXG4gIGlmICh0aGlzLnJlc3RPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2UpIHtcbiAgICBhZGRpdGlvbmFsT3B0aW9ucy5yZWFkUHJlZmVyZW5jZSA9IHRoaXMucmVzdE9wdGlvbnMuc3VicXVlcnlSZWFkUHJlZmVyZW5jZTtcbiAgICBhZGRpdGlvbmFsT3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlID0gdGhpcy5yZXN0T3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlO1xuICB9XG5cbiAgdmFyIHN1YnF1ZXJ5ID0gbmV3IFJlc3RRdWVyeShcbiAgICB0aGlzLmNvbmZpZyxcbiAgICB0aGlzLmF1dGgsXG4gICAgc2VsZWN0VmFsdWUucXVlcnkuY2xhc3NOYW1lLFxuICAgIHNlbGVjdFZhbHVlLnF1ZXJ5LndoZXJlLFxuICAgIGFkZGl0aW9uYWxPcHRpb25zXG4gICk7XG4gIHJldHVybiBzdWJxdWVyeS5leGVjdXRlKCkudGhlbihyZXNwb25zZSA9PiB7XG4gICAgdHJhbnNmb3JtU2VsZWN0KHNlbGVjdE9iamVjdCwgc2VsZWN0VmFsdWUua2V5LCByZXNwb25zZS5yZXN1bHRzKTtcbiAgICAvLyBLZWVwIHJlcGxhY2luZyAkc2VsZWN0IGNsYXVzZXNcbiAgICByZXR1cm4gdGhpcy5yZXBsYWNlU2VsZWN0KCk7XG4gIH0pO1xufTtcblxuY29uc3QgdHJhbnNmb3JtRG9udFNlbGVjdCA9IChkb250U2VsZWN0T2JqZWN0LCBrZXksIG9iamVjdHMpID0+IHtcbiAgdmFyIHZhbHVlcyA9IFtdO1xuICBmb3IgKHZhciByZXN1bHQgb2Ygb2JqZWN0cykge1xuICAgIHZhbHVlcy5wdXNoKGtleS5zcGxpdCgnLicpLnJlZHVjZSgobywgaSkgPT4gb1tpXSwgcmVzdWx0KSk7XG4gIH1cbiAgZGVsZXRlIGRvbnRTZWxlY3RPYmplY3RbJyRkb250U2VsZWN0J107XG4gIGlmIChBcnJheS5pc0FycmF5KGRvbnRTZWxlY3RPYmplY3RbJyRuaW4nXSkpIHtcbiAgICBkb250U2VsZWN0T2JqZWN0WyckbmluJ10gPSBkb250U2VsZWN0T2JqZWN0WyckbmluJ10uY29uY2F0KHZhbHVlcyk7XG4gIH0gZWxzZSB7XG4gICAgZG9udFNlbGVjdE9iamVjdFsnJG5pbiddID0gdmFsdWVzO1xuICB9XG59O1xuXG4vLyBSZXBsYWNlcyBhICRkb250U2VsZWN0IGNsYXVzZSBieSBydW5uaW5nIHRoZSBzdWJxdWVyeSwgaWYgdGhlcmUgaXMgYVxuLy8gJGRvbnRTZWxlY3QgY2xhdXNlLlxuLy8gVGhlICRkb250U2VsZWN0IGNsYXVzZSB0dXJucyBpbnRvIGFuICRuaW4gd2l0aCB2YWx1ZXMgc2VsZWN0ZWQgb3V0IG9mXG4vLyB0aGUgc3VicXVlcnkuXG4vLyBSZXR1cm5zIGEgcG9zc2libGUtcHJvbWlzZS5cblJlc3RRdWVyeS5wcm90b3R5cGUucmVwbGFjZURvbnRTZWxlY3QgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGRvbnRTZWxlY3RPYmplY3QgPSBmaW5kT2JqZWN0V2l0aEtleSh0aGlzLnJlc3RXaGVyZSwgJyRkb250U2VsZWN0Jyk7XG4gIGlmICghZG9udFNlbGVjdE9iamVjdCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIFRoZSBkb250U2VsZWN0IHZhbHVlIG11c3QgaGF2ZSBwcmVjaXNlbHkgdHdvIGtleXMgLSBxdWVyeSBhbmQga2V5XG4gIHZhciBkb250U2VsZWN0VmFsdWUgPSBkb250U2VsZWN0T2JqZWN0WyckZG9udFNlbGVjdCddO1xuICBpZiAoXG4gICAgIWRvbnRTZWxlY3RWYWx1ZS5xdWVyeSB8fFxuICAgICFkb250U2VsZWN0VmFsdWUua2V5IHx8XG4gICAgdHlwZW9mIGRvbnRTZWxlY3RWYWx1ZS5xdWVyeSAhPT0gJ29iamVjdCcgfHxcbiAgICAhZG9udFNlbGVjdFZhbHVlLnF1ZXJ5LmNsYXNzTmFtZSB8fFxuICAgIE9iamVjdC5rZXlzKGRvbnRTZWxlY3RWYWx1ZSkubGVuZ3RoICE9PSAyXG4gICkge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksXG4gICAgICAnaW1wcm9wZXIgdXNhZ2Ugb2YgJGRvbnRTZWxlY3QnXG4gICAgKTtcbiAgfVxuICBjb25zdCBhZGRpdGlvbmFsT3B0aW9ucyA9IHtcbiAgICByZWRpcmVjdENsYXNzTmFtZUZvcktleTogZG9udFNlbGVjdFZhbHVlLnF1ZXJ5LnJlZGlyZWN0Q2xhc3NOYW1lRm9yS2V5LFxuICB9O1xuXG4gIGlmICh0aGlzLnJlc3RPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2UpIHtcbiAgICBhZGRpdGlvbmFsT3B0aW9ucy5yZWFkUHJlZmVyZW5jZSA9IHRoaXMucmVzdE9wdGlvbnMuc3VicXVlcnlSZWFkUHJlZmVyZW5jZTtcbiAgICBhZGRpdGlvbmFsT3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlID0gdGhpcy5yZXN0T3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlO1xuICB9XG5cbiAgdmFyIHN1YnF1ZXJ5ID0gbmV3IFJlc3RRdWVyeShcbiAgICB0aGlzLmNvbmZpZyxcbiAgICB0aGlzLmF1dGgsXG4gICAgZG9udFNlbGVjdFZhbHVlLnF1ZXJ5LmNsYXNzTmFtZSxcbiAgICBkb250U2VsZWN0VmFsdWUucXVlcnkud2hlcmUsXG4gICAgYWRkaXRpb25hbE9wdGlvbnNcbiAgKTtcbiAgcmV0dXJuIHN1YnF1ZXJ5LmV4ZWN1dGUoKS50aGVuKHJlc3BvbnNlID0+IHtcbiAgICB0cmFuc2Zvcm1Eb250U2VsZWN0KFxuICAgICAgZG9udFNlbGVjdE9iamVjdCxcbiAgICAgIGRvbnRTZWxlY3RWYWx1ZS5rZXksXG4gICAgICByZXNwb25zZS5yZXN1bHRzXG4gICAgKTtcbiAgICAvLyBLZWVwIHJlcGxhY2luZyAkZG9udFNlbGVjdCBjbGF1c2VzXG4gICAgcmV0dXJuIHRoaXMucmVwbGFjZURvbnRTZWxlY3QoKTtcbiAgfSk7XG59O1xuXG5jb25zdCBjbGVhblJlc3VsdEF1dGhEYXRhID0gZnVuY3Rpb24ocmVzdWx0KSB7XG4gIGRlbGV0ZSByZXN1bHQucGFzc3dvcmQ7XG4gIGlmIChyZXN1bHQuYXV0aERhdGEpIHtcbiAgICBPYmplY3Qua2V5cyhyZXN1bHQuYXV0aERhdGEpLmZvckVhY2gocHJvdmlkZXIgPT4ge1xuICAgICAgaWYgKHJlc3VsdC5hdXRoRGF0YVtwcm92aWRlcl0gPT09IG51bGwpIHtcbiAgICAgICAgZGVsZXRlIHJlc3VsdC5hdXRoRGF0YVtwcm92aWRlcl07XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBpZiAoT2JqZWN0LmtleXMocmVzdWx0LmF1dGhEYXRhKS5sZW5ndGggPT0gMCkge1xuICAgICAgZGVsZXRlIHJlc3VsdC5hdXRoRGF0YTtcbiAgICB9XG4gIH1cbn07XG5cbmNvbnN0IHJlcGxhY2VFcXVhbGl0eUNvbnN0cmFpbnQgPSBjb25zdHJhaW50ID0+IHtcbiAgaWYgKHR5cGVvZiBjb25zdHJhaW50ICE9PSAnb2JqZWN0Jykge1xuICAgIHJldHVybiBjb25zdHJhaW50O1xuICB9XG4gIGNvbnN0IGVxdWFsVG9PYmplY3QgPSB7fTtcbiAgbGV0IGhhc0RpcmVjdENvbnN0cmFpbnQgPSBmYWxzZTtcbiAgbGV0IGhhc09wZXJhdG9yQ29uc3RyYWludCA9IGZhbHNlO1xuICBmb3IgKGNvbnN0IGtleSBpbiBjb25zdHJhaW50KSB7XG4gICAgaWYgKGtleS5pbmRleE9mKCckJykgIT09IDApIHtcbiAgICAgIGhhc0RpcmVjdENvbnN0cmFpbnQgPSB0cnVlO1xuICAgICAgZXF1YWxUb09iamVjdFtrZXldID0gY29uc3RyYWludFtrZXldO1xuICAgIH0gZWxzZSB7XG4gICAgICBoYXNPcGVyYXRvckNvbnN0cmFpbnQgPSB0cnVlO1xuICAgIH1cbiAgfVxuICBpZiAoaGFzRGlyZWN0Q29uc3RyYWludCAmJiBoYXNPcGVyYXRvckNvbnN0cmFpbnQpIHtcbiAgICBjb25zdHJhaW50WyckZXEnXSA9IGVxdWFsVG9PYmplY3Q7XG4gICAgT2JqZWN0LmtleXMoZXF1YWxUb09iamVjdCkuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgZGVsZXRlIGNvbnN0cmFpbnRba2V5XTtcbiAgICB9KTtcbiAgfVxuICByZXR1cm4gY29uc3RyYWludDtcbn07XG5cblJlc3RRdWVyeS5wcm90b3R5cGUucmVwbGFjZUVxdWFsaXR5ID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0eXBlb2YgdGhpcy5yZXN0V2hlcmUgIT09ICdvYmplY3QnKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGZvciAoY29uc3Qga2V5IGluIHRoaXMucmVzdFdoZXJlKSB7XG4gICAgdGhpcy5yZXN0V2hlcmVba2V5XSA9IHJlcGxhY2VFcXVhbGl0eUNvbnN0cmFpbnQodGhpcy5yZXN0V2hlcmVba2V5XSk7XG4gIH1cbn07XG5cbi8vIFJldHVybnMgYSBwcm9taXNlIGZvciB3aGV0aGVyIGl0IHdhcyBzdWNjZXNzZnVsLlxuLy8gUG9wdWxhdGVzIHRoaXMucmVzcG9uc2Ugd2l0aCBhbiBvYmplY3QgdGhhdCBvbmx5IGhhcyAncmVzdWx0cycuXG5SZXN0UXVlcnkucHJvdG90eXBlLnJ1bkZpbmQgPSBmdW5jdGlvbihvcHRpb25zID0ge30pIHtcbiAgaWYgKHRoaXMuZmluZE9wdGlvbnMubGltaXQgPT09IDApIHtcbiAgICB0aGlzLnJlc3BvbnNlID0geyByZXN1bHRzOiBbXSB9O1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuICBjb25zdCBmaW5kT3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe30sIHRoaXMuZmluZE9wdGlvbnMpO1xuICBpZiAodGhpcy5rZXlzKSB7XG4gICAgZmluZE9wdGlvbnMua2V5cyA9IHRoaXMua2V5cy5tYXAoa2V5ID0+IHtcbiAgICAgIHJldHVybiBrZXkuc3BsaXQoJy4nKVswXTtcbiAgICB9KTtcbiAgfVxuICBpZiAob3B0aW9ucy5vcCkge1xuICAgIGZpbmRPcHRpb25zLm9wID0gb3B0aW9ucy5vcDtcbiAgfVxuICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2VcbiAgICAuZmluZCh0aGlzLmNsYXNzTmFtZSwgdGhpcy5yZXN0V2hlcmUsIGZpbmRPcHRpb25zLCB0aGlzLmF1dGgpXG4gICAgLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICBpZiAodGhpcy5jbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICAgICAgZm9yICh2YXIgcmVzdWx0IG9mIHJlc3VsdHMpIHtcbiAgICAgICAgICBjbGVhblJlc3VsdEF1dGhEYXRhKHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgdGhpcy5jb25maWcuZmlsZXNDb250cm9sbGVyLmV4cGFuZEZpbGVzSW5PYmplY3QodGhpcy5jb25maWcsIHJlc3VsdHMpO1xuXG4gICAgICBpZiAodGhpcy5yZWRpcmVjdENsYXNzTmFtZSkge1xuICAgICAgICBmb3IgKHZhciByIG9mIHJlc3VsdHMpIHtcbiAgICAgICAgICByLmNsYXNzTmFtZSA9IHRoaXMucmVkaXJlY3RDbGFzc05hbWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHRoaXMucmVzcG9uc2UgPSB7IHJlc3VsdHM6IHJlc3VsdHMgfTtcbiAgICB9KTtcbn07XG5cbi8vIFJldHVybnMgYSBwcm9taXNlIGZvciB3aGV0aGVyIGl0IHdhcyBzdWNjZXNzZnVsLlxuLy8gUG9wdWxhdGVzIHRoaXMucmVzcG9uc2UuY291bnQgd2l0aCB0aGUgY291bnRcblJlc3RRdWVyeS5wcm90b3R5cGUucnVuQ291bnQgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLmRvQ291bnQpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgdGhpcy5maW5kT3B0aW9ucy5jb3VudCA9IHRydWU7XG4gIGRlbGV0ZSB0aGlzLmZpbmRPcHRpb25zLnNraXA7XG4gIGRlbGV0ZSB0aGlzLmZpbmRPcHRpb25zLmxpbWl0O1xuICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2VcbiAgICAuZmluZCh0aGlzLmNsYXNzTmFtZSwgdGhpcy5yZXN0V2hlcmUsIHRoaXMuZmluZE9wdGlvbnMpXG4gICAgLnRoZW4oYyA9PiB7XG4gICAgICB0aGlzLnJlc3BvbnNlLmNvdW50ID0gYztcbiAgICB9KTtcbn07XG5cbi8vIEF1Z21lbnRzIHRoaXMucmVzcG9uc2Ugd2l0aCBhbGwgcG9pbnRlcnMgb24gYW4gb2JqZWN0XG5SZXN0UXVlcnkucHJvdG90eXBlLmhhbmRsZUluY2x1ZGVBbGwgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLmluY2x1ZGVBbGwpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlXG4gICAgLmxvYWRTY2hlbWEoKVxuICAgIC50aGVuKHNjaGVtYUNvbnRyb2xsZXIgPT4gc2NoZW1hQ29udHJvbGxlci5nZXRPbmVTY2hlbWEodGhpcy5jbGFzc05hbWUpKVxuICAgIC50aGVuKHNjaGVtYSA9PiB7XG4gICAgICBjb25zdCBpbmNsdWRlRmllbGRzID0gW107XG4gICAgICBjb25zdCBrZXlGaWVsZHMgPSBbXTtcbiAgICAgIGZvciAoY29uc3QgZmllbGQgaW4gc2NoZW1hLmZpZWxkcykge1xuICAgICAgICBpZiAoXG4gICAgICAgICAgc2NoZW1hLmZpZWxkc1tmaWVsZF0udHlwZSAmJlxuICAgICAgICAgIHNjaGVtYS5maWVsZHNbZmllbGRdLnR5cGUgPT09ICdQb2ludGVyJ1xuICAgICAgICApIHtcbiAgICAgICAgICBpbmNsdWRlRmllbGRzLnB1c2goW2ZpZWxkXSk7XG4gICAgICAgICAga2V5RmllbGRzLnB1c2goZmllbGQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvLyBBZGQgZmllbGRzIHRvIGluY2x1ZGUsIGtleXMsIHJlbW92ZSBkdXBzXG4gICAgICB0aGlzLmluY2x1ZGUgPSBbLi4ubmV3IFNldChbLi4udGhpcy5pbmNsdWRlLCAuLi5pbmNsdWRlRmllbGRzXSldO1xuICAgICAgLy8gaWYgdGhpcy5rZXlzIG5vdCBzZXQsIHRoZW4gYWxsIGtleXMgYXJlIGFscmVhZHkgaW5jbHVkZWRcbiAgICAgIGlmICh0aGlzLmtleXMpIHtcbiAgICAgICAgdGhpcy5rZXlzID0gWy4uLm5ldyBTZXQoWy4uLnRoaXMua2V5cywgLi4ua2V5RmllbGRzXSldO1xuICAgICAgfVxuICAgIH0pO1xufTtcblxuLy8gQXVnbWVudHMgdGhpcy5yZXNwb25zZSB3aXRoIGRhdGEgYXQgdGhlIHBhdGhzIHByb3ZpZGVkIGluIHRoaXMuaW5jbHVkZS5cblJlc3RRdWVyeS5wcm90b3R5cGUuaGFuZGxlSW5jbHVkZSA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5pbmNsdWRlLmxlbmd0aCA9PSAwKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgdmFyIHBhdGhSZXNwb25zZSA9IGluY2x1ZGVQYXRoKFxuICAgIHRoaXMuY29uZmlnLFxuICAgIHRoaXMuYXV0aCxcbiAgICB0aGlzLnJlc3BvbnNlLFxuICAgIHRoaXMuaW5jbHVkZVswXSxcbiAgICB0aGlzLnJlc3RPcHRpb25zXG4gICk7XG4gIGlmIChwYXRoUmVzcG9uc2UudGhlbikge1xuICAgIHJldHVybiBwYXRoUmVzcG9uc2UudGhlbihuZXdSZXNwb25zZSA9PiB7XG4gICAgICB0aGlzLnJlc3BvbnNlID0gbmV3UmVzcG9uc2U7XG4gICAgICB0aGlzLmluY2x1ZGUgPSB0aGlzLmluY2x1ZGUuc2xpY2UoMSk7XG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVJbmNsdWRlKCk7XG4gICAgfSk7XG4gIH0gZWxzZSBpZiAodGhpcy5pbmNsdWRlLmxlbmd0aCA+IDApIHtcbiAgICB0aGlzLmluY2x1ZGUgPSB0aGlzLmluY2x1ZGUuc2xpY2UoMSk7XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlSW5jbHVkZSgpO1xuICB9XG5cbiAgcmV0dXJuIHBhdGhSZXNwb25zZTtcbn07XG5cbi8vUmV0dXJucyBhIHByb21pc2Ugb2YgYSBwcm9jZXNzZWQgc2V0IG9mIHJlc3VsdHNcblJlc3RRdWVyeS5wcm90b3R5cGUucnVuQWZ0ZXJGaW5kVHJpZ2dlciA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMucmVzcG9uc2UpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gQXZvaWQgZG9pbmcgYW55IHNldHVwIGZvciB0cmlnZ2VycyBpZiB0aGVyZSBpcyBubyAnYWZ0ZXJGaW5kJyB0cmlnZ2VyIGZvciB0aGlzIGNsYXNzLlxuICBjb25zdCBoYXNBZnRlckZpbmRIb29rID0gdHJpZ2dlcnMudHJpZ2dlckV4aXN0cyhcbiAgICB0aGlzLmNsYXNzTmFtZSxcbiAgICB0cmlnZ2Vycy5UeXBlcy5hZnRlckZpbmQsXG4gICAgdGhpcy5jb25maWcuYXBwbGljYXRpb25JZFxuICApO1xuICBpZiAoIWhhc0FmdGVyRmluZEhvb2spIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cbiAgLy8gU2tpcCBBZ2dyZWdhdGUgYW5kIERpc3RpbmN0IFF1ZXJpZXNcbiAgaWYgKHRoaXMuZmluZE9wdGlvbnMucGlwZWxpbmUgfHwgdGhpcy5maW5kT3B0aW9ucy5kaXN0aW5jdCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuICAvLyBSdW4gYWZ0ZXJGaW5kIHRyaWdnZXIgYW5kIHNldCB0aGUgbmV3IHJlc3VsdHNcbiAgcmV0dXJuIHRyaWdnZXJzXG4gICAgLm1heWJlUnVuQWZ0ZXJGaW5kVHJpZ2dlcihcbiAgICAgIHRyaWdnZXJzLlR5cGVzLmFmdGVyRmluZCxcbiAgICAgIHRoaXMuYXV0aCxcbiAgICAgIHRoaXMuY2xhc3NOYW1lLFxuICAgICAgdGhpcy5yZXNwb25zZS5yZXN1bHRzLFxuICAgICAgdGhpcy5jb25maWdcbiAgICApXG4gICAgLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICAvLyBFbnN1cmUgd2UgcHJvcGVybHkgc2V0IHRoZSBjbGFzc05hbWUgYmFja1xuICAgICAgaWYgKHRoaXMucmVkaXJlY3RDbGFzc05hbWUpIHtcbiAgICAgICAgdGhpcy5yZXNwb25zZS5yZXN1bHRzID0gcmVzdWx0cy5tYXAob2JqZWN0ID0+IHtcbiAgICAgICAgICBpZiAob2JqZWN0IGluc3RhbmNlb2YgUGFyc2UuT2JqZWN0KSB7XG4gICAgICAgICAgICBvYmplY3QgPSBvYmplY3QudG9KU09OKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIG9iamVjdC5jbGFzc05hbWUgPSB0aGlzLnJlZGlyZWN0Q2xhc3NOYW1lO1xuICAgICAgICAgIHJldHVybiBvYmplY3Q7XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5yZXNwb25zZS5yZXN1bHRzID0gcmVzdWx0cztcbiAgICAgIH1cbiAgICB9KTtcbn07XG5cbi8vIEFkZHMgaW5jbHVkZWQgdmFsdWVzIHRvIHRoZSByZXNwb25zZS5cbi8vIFBhdGggaXMgYSBsaXN0IG9mIGZpZWxkIG5hbWVzLlxuLy8gUmV0dXJucyBhIHByb21pc2UgZm9yIGFuIGF1Z21lbnRlZCByZXNwb25zZS5cbmZ1bmN0aW9uIGluY2x1ZGVQYXRoKGNvbmZpZywgYXV0aCwgcmVzcG9uc2UsIHBhdGgsIHJlc3RPcHRpb25zID0ge30pIHtcbiAgdmFyIHBvaW50ZXJzID0gZmluZFBvaW50ZXJzKHJlc3BvbnNlLnJlc3VsdHMsIHBhdGgpO1xuICBpZiAocG9pbnRlcnMubGVuZ3RoID09IDApIHtcbiAgICByZXR1cm4gcmVzcG9uc2U7XG4gIH1cbiAgY29uc3QgcG9pbnRlcnNIYXNoID0ge307XG4gIGZvciAodmFyIHBvaW50ZXIgb2YgcG9pbnRlcnMpIHtcbiAgICBpZiAoIXBvaW50ZXIpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBjbGFzc05hbWUgPSBwb2ludGVyLmNsYXNzTmFtZTtcbiAgICAvLyBvbmx5IGluY2x1ZGUgdGhlIGdvb2QgcG9pbnRlcnNcbiAgICBpZiAoY2xhc3NOYW1lKSB7XG4gICAgICBwb2ludGVyc0hhc2hbY2xhc3NOYW1lXSA9IHBvaW50ZXJzSGFzaFtjbGFzc05hbWVdIHx8IG5ldyBTZXQoKTtcbiAgICAgIHBvaW50ZXJzSGFzaFtjbGFzc05hbWVdLmFkZChwb2ludGVyLm9iamVjdElkKTtcbiAgICB9XG4gIH1cbiAgY29uc3QgaW5jbHVkZVJlc3RPcHRpb25zID0ge307XG4gIGlmIChyZXN0T3B0aW9ucy5rZXlzKSB7XG4gICAgY29uc3Qga2V5cyA9IG5ldyBTZXQocmVzdE9wdGlvbnMua2V5cy5zcGxpdCgnLCcpKTtcbiAgICBjb25zdCBrZXlTZXQgPSBBcnJheS5mcm9tKGtleXMpLnJlZHVjZSgoc2V0LCBrZXkpID0+IHtcbiAgICAgIGNvbnN0IGtleVBhdGggPSBrZXkuc3BsaXQoJy4nKTtcbiAgICAgIGxldCBpID0gMDtcbiAgICAgIGZvciAoaTsgaSA8IHBhdGgubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgaWYgKHBhdGhbaV0gIT0ga2V5UGF0aFtpXSkge1xuICAgICAgICAgIHJldHVybiBzZXQ7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChpIDwga2V5UGF0aC5sZW5ndGgpIHtcbiAgICAgICAgc2V0LmFkZChrZXlQYXRoW2ldKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBzZXQ7XG4gICAgfSwgbmV3IFNldCgpKTtcbiAgICBpZiAoa2V5U2V0LnNpemUgPiAwKSB7XG4gICAgICBpbmNsdWRlUmVzdE9wdGlvbnMua2V5cyA9IEFycmF5LmZyb20oa2V5U2V0KS5qb2luKCcsJyk7XG4gICAgfVxuICB9XG5cbiAgaWYgKHJlc3RPcHRpb25zLmluY2x1ZGVSZWFkUHJlZmVyZW5jZSkge1xuICAgIGluY2x1ZGVSZXN0T3B0aW9ucy5yZWFkUHJlZmVyZW5jZSA9IHJlc3RPcHRpb25zLmluY2x1ZGVSZWFkUHJlZmVyZW5jZTtcbiAgICBpbmNsdWRlUmVzdE9wdGlvbnMuaW5jbHVkZVJlYWRQcmVmZXJlbmNlID1cbiAgICAgIHJlc3RPcHRpb25zLmluY2x1ZGVSZWFkUHJlZmVyZW5jZTtcbiAgfVxuXG4gIGNvbnN0IHF1ZXJ5UHJvbWlzZXMgPSBPYmplY3Qua2V5cyhwb2ludGVyc0hhc2gpLm1hcChjbGFzc05hbWUgPT4ge1xuICAgIGNvbnN0IG9iamVjdElkcyA9IEFycmF5LmZyb20ocG9pbnRlcnNIYXNoW2NsYXNzTmFtZV0pO1xuICAgIGxldCB3aGVyZTtcbiAgICBpZiAob2JqZWN0SWRzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgd2hlcmUgPSB7IG9iamVjdElkOiBvYmplY3RJZHNbMF0gfTtcbiAgICB9IGVsc2Uge1xuICAgICAgd2hlcmUgPSB7IG9iamVjdElkOiB7ICRpbjogb2JqZWN0SWRzIH0gfTtcbiAgICB9XG4gICAgdmFyIHF1ZXJ5ID0gbmV3IFJlc3RRdWVyeShcbiAgICAgIGNvbmZpZyxcbiAgICAgIGF1dGgsXG4gICAgICBjbGFzc05hbWUsXG4gICAgICB3aGVyZSxcbiAgICAgIGluY2x1ZGVSZXN0T3B0aW9uc1xuICAgICk7XG4gICAgcmV0dXJuIHF1ZXJ5LmV4ZWN1dGUoeyBvcDogJ2dldCcgfSkudGhlbihyZXN1bHRzID0+IHtcbiAgICAgIHJlc3VsdHMuY2xhc3NOYW1lID0gY2xhc3NOYW1lO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShyZXN1bHRzKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgLy8gR2V0IHRoZSBvYmplY3RzIGZvciBhbGwgdGhlc2Ugb2JqZWN0IGlkc1xuICByZXR1cm4gUHJvbWlzZS5hbGwocXVlcnlQcm9taXNlcykudGhlbihyZXNwb25zZXMgPT4ge1xuICAgIHZhciByZXBsYWNlID0gcmVzcG9uc2VzLnJlZHVjZSgocmVwbGFjZSwgaW5jbHVkZVJlc3BvbnNlKSA9PiB7XG4gICAgICBmb3IgKHZhciBvYmogb2YgaW5jbHVkZVJlc3BvbnNlLnJlc3VsdHMpIHtcbiAgICAgICAgb2JqLl9fdHlwZSA9ICdPYmplY3QnO1xuICAgICAgICBvYmouY2xhc3NOYW1lID0gaW5jbHVkZVJlc3BvbnNlLmNsYXNzTmFtZTtcblxuICAgICAgICBpZiAob2JqLmNsYXNzTmFtZSA9PSAnX1VzZXInICYmICFhdXRoLmlzTWFzdGVyKSB7XG4gICAgICAgICAgZGVsZXRlIG9iai5zZXNzaW9uVG9rZW47XG4gICAgICAgICAgZGVsZXRlIG9iai5hdXRoRGF0YTtcbiAgICAgICAgfVxuICAgICAgICByZXBsYWNlW29iai5vYmplY3RJZF0gPSBvYmo7XG4gICAgICB9XG4gICAgICByZXR1cm4gcmVwbGFjZTtcbiAgICB9LCB7fSk7XG5cbiAgICB2YXIgcmVzcCA9IHtcbiAgICAgIHJlc3VsdHM6IHJlcGxhY2VQb2ludGVycyhyZXNwb25zZS5yZXN1bHRzLCBwYXRoLCByZXBsYWNlKSxcbiAgICB9O1xuICAgIGlmIChyZXNwb25zZS5jb3VudCkge1xuICAgICAgcmVzcC5jb3VudCA9IHJlc3BvbnNlLmNvdW50O1xuICAgIH1cbiAgICByZXR1cm4gcmVzcDtcbiAgfSk7XG59XG5cbi8vIE9iamVjdCBtYXkgYmUgYSBsaXN0IG9mIFJFU1QtZm9ybWF0IG9iamVjdCB0byBmaW5kIHBvaW50ZXJzIGluLCBvclxuLy8gaXQgbWF5IGJlIGEgc2luZ2xlIG9iamVjdC5cbi8vIElmIHRoZSBwYXRoIHlpZWxkcyB0aGluZ3MgdGhhdCBhcmVuJ3QgcG9pbnRlcnMsIHRoaXMgdGhyb3dzIGFuIGVycm9yLlxuLy8gUGF0aCBpcyBhIGxpc3Qgb2YgZmllbGRzIHRvIHNlYXJjaCBpbnRvLlxuLy8gUmV0dXJucyBhIGxpc3Qgb2YgcG9pbnRlcnMgaW4gUkVTVCBmb3JtYXQuXG5mdW5jdGlvbiBmaW5kUG9pbnRlcnMob2JqZWN0LCBwYXRoKSB7XG4gIGlmIChvYmplY3QgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgIHZhciBhbnN3ZXIgPSBbXTtcbiAgICBmb3IgKHZhciB4IG9mIG9iamVjdCkge1xuICAgICAgYW5zd2VyID0gYW5zd2VyLmNvbmNhdChmaW5kUG9pbnRlcnMoeCwgcGF0aCkpO1xuICAgIH1cbiAgICByZXR1cm4gYW5zd2VyO1xuICB9XG5cbiAgaWYgKHR5cGVvZiBvYmplY3QgIT09ICdvYmplY3QnIHx8ICFvYmplY3QpIHtcbiAgICByZXR1cm4gW107XG4gIH1cblxuICBpZiAocGF0aC5sZW5ndGggPT0gMCkge1xuICAgIGlmIChvYmplY3QgPT09IG51bGwgfHwgb2JqZWN0Ll9fdHlwZSA9PSAnUG9pbnRlcicpIHtcbiAgICAgIHJldHVybiBbb2JqZWN0XTtcbiAgICB9XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgdmFyIHN1Ym9iamVjdCA9IG9iamVjdFtwYXRoWzBdXTtcbiAgaWYgKCFzdWJvYmplY3QpIHtcbiAgICByZXR1cm4gW107XG4gIH1cbiAgcmV0dXJuIGZpbmRQb2ludGVycyhzdWJvYmplY3QsIHBhdGguc2xpY2UoMSkpO1xufVxuXG4vLyBPYmplY3QgbWF5IGJlIGEgbGlzdCBvZiBSRVNULWZvcm1hdCBvYmplY3RzIHRvIHJlcGxhY2UgcG9pbnRlcnNcbi8vIGluLCBvciBpdCBtYXkgYmUgYSBzaW5nbGUgb2JqZWN0LlxuLy8gUGF0aCBpcyBhIGxpc3Qgb2YgZmllbGRzIHRvIHNlYXJjaCBpbnRvLlxuLy8gcmVwbGFjZSBpcyBhIG1hcCBmcm9tIG9iamVjdCBpZCAtPiBvYmplY3QuXG4vLyBSZXR1cm5zIHNvbWV0aGluZyBhbmFsb2dvdXMgdG8gb2JqZWN0LCBidXQgd2l0aCB0aGUgYXBwcm9wcmlhdGVcbi8vIHBvaW50ZXJzIGluZmxhdGVkLlxuZnVuY3Rpb24gcmVwbGFjZVBvaW50ZXJzKG9iamVjdCwgcGF0aCwgcmVwbGFjZSkge1xuICBpZiAob2JqZWN0IGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICByZXR1cm4gb2JqZWN0XG4gICAgICAubWFwKG9iaiA9PiByZXBsYWNlUG9pbnRlcnMob2JqLCBwYXRoLCByZXBsYWNlKSlcbiAgICAgIC5maWx0ZXIob2JqID0+IHR5cGVvZiBvYmogIT09ICd1bmRlZmluZWQnKTtcbiAgfVxuXG4gIGlmICh0eXBlb2Ygb2JqZWN0ICE9PSAnb2JqZWN0JyB8fCAhb2JqZWN0KSB7XG4gICAgcmV0dXJuIG9iamVjdDtcbiAgfVxuXG4gIGlmIChwYXRoLmxlbmd0aCA9PT0gMCkge1xuICAgIGlmIChvYmplY3QgJiYgb2JqZWN0Ll9fdHlwZSA9PT0gJ1BvaW50ZXInKSB7XG4gICAgICByZXR1cm4gcmVwbGFjZVtvYmplY3Qub2JqZWN0SWRdO1xuICAgIH1cbiAgICByZXR1cm4gb2JqZWN0O1xuICB9XG5cbiAgdmFyIHN1Ym9iamVjdCA9IG9iamVjdFtwYXRoWzBdXTtcbiAgaWYgKCFzdWJvYmplY3QpIHtcbiAgICByZXR1cm4gb2JqZWN0O1xuICB9XG4gIHZhciBuZXdzdWIgPSByZXBsYWNlUG9pbnRlcnMoc3Vib2JqZWN0LCBwYXRoLnNsaWNlKDEpLCByZXBsYWNlKTtcbiAgdmFyIGFuc3dlciA9IHt9O1xuICBmb3IgKHZhciBrZXkgaW4gb2JqZWN0KSB7XG4gICAgaWYgKGtleSA9PSBwYXRoWzBdKSB7XG4gICAgICBhbnN3ZXJba2V5XSA9IG5ld3N1YjtcbiAgICB9IGVsc2Uge1xuICAgICAgYW5zd2VyW2tleV0gPSBvYmplY3Rba2V5XTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGFuc3dlcjtcbn1cblxuLy8gRmluZHMgYSBzdWJvYmplY3QgdGhhdCBoYXMgdGhlIGdpdmVuIGtleSwgaWYgdGhlcmUgaXMgb25lLlxuLy8gUmV0dXJucyB1bmRlZmluZWQgb3RoZXJ3aXNlLlxuZnVuY3Rpb24gZmluZE9iamVjdFdpdGhLZXkocm9vdCwga2V5KSB7XG4gIGlmICh0eXBlb2Ygcm9vdCAhPT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHJvb3QgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgIGZvciAodmFyIGl0ZW0gb2Ygcm9vdCkge1xuICAgICAgY29uc3QgYW5zd2VyID0gZmluZE9iamVjdFdpdGhLZXkoaXRlbSwga2V5KTtcbiAgICAgIGlmIChhbnN3ZXIpIHtcbiAgICAgICAgcmV0dXJuIGFuc3dlcjtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgaWYgKHJvb3QgJiYgcm9vdFtrZXldKSB7XG4gICAgcmV0dXJuIHJvb3Q7XG4gIH1cbiAgZm9yICh2YXIgc3Via2V5IGluIHJvb3QpIHtcbiAgICBjb25zdCBhbnN3ZXIgPSBmaW5kT2JqZWN0V2l0aEtleShyb290W3N1YmtleV0sIGtleSk7XG4gICAgaWYgKGFuc3dlcikge1xuICAgICAgcmV0dXJuIGFuc3dlcjtcbiAgICB9XG4gIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBSZXN0UXVlcnk7XG4iXX0=