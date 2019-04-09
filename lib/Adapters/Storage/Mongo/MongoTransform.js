"use strict";

var _logger = _interopRequireDefault(require("../../../logger"));

var _lodash = _interopRequireDefault(require("lodash"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; var ownKeys = Object.keys(source); if (typeof Object.getOwnPropertySymbols === 'function') { ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function (sym) { return Object.getOwnPropertyDescriptor(source, sym).enumerable; })); } ownKeys.forEach(function (key) { _defineProperty(target, key, source[key]); }); } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

var mongodb = require('mongodb');

var Parse = require('parse/node').Parse;

const transformKey = (className, fieldName, schema) => {
  // Check if the schema is known since it's a built-in field.
  switch (fieldName) {
    case 'objectId':
      return '_id';

    case 'createdAt':
      return '_created_at';

    case 'updatedAt':
      return '_updated_at';

    case 'sessionToken':
      return '_session_token';

    case 'lastUsed':
      return '_last_used';

    case 'timesUsed':
      return 'times_used';
  }

  if (schema.fields[fieldName] && schema.fields[fieldName].__type == 'Pointer') {
    fieldName = '_p_' + fieldName;
  } else if (schema.fields[fieldName] && schema.fields[fieldName].type == 'Pointer') {
    fieldName = '_p_' + fieldName;
  }

  return fieldName;
};

const transformKeyValueForUpdate = (className, restKey, restValue, parseFormatSchema) => {
  // Check if the schema is known since it's a built-in field.
  var key = restKey;
  var timeField = false;

  switch (key) {
    case 'objectId':
    case '_id':
      if (className === '_GlobalConfig') {
        return {
          key: key,
          value: parseInt(restValue)
        };
      }

      key = '_id';
      break;

    case 'createdAt':
    case '_created_at':
      key = '_created_at';
      timeField = true;
      break;

    case 'updatedAt':
    case '_updated_at':
      key = '_updated_at';
      timeField = true;
      break;

    case 'sessionToken':
    case '_session_token':
      key = '_session_token';
      break;

    case 'expiresAt':
    case '_expiresAt':
      key = 'expiresAt';
      timeField = true;
      break;

    case '_email_verify_token_expires_at':
      key = '_email_verify_token_expires_at';
      timeField = true;
      break;

    case '_account_lockout_expires_at':
      key = '_account_lockout_expires_at';
      timeField = true;
      break;

    case '_failed_login_count':
      key = '_failed_login_count';
      break;

    case '_perishable_token_expires_at':
      key = '_perishable_token_expires_at';
      timeField = true;
      break;

    case '_password_changed_at':
      key = '_password_changed_at';
      timeField = true;
      break;

    case '_rperm':
    case '_wperm':
      return {
        key: key,
        value: restValue
      };

    case 'lastUsed':
    case '_last_used':
      key = '_last_used';
      timeField = true;
      break;

    case 'timesUsed':
    case 'times_used':
      key = 'times_used';
      timeField = true;
      break;
  }

  if (parseFormatSchema.fields[key] && parseFormatSchema.fields[key].type === 'Pointer' || !parseFormatSchema.fields[key] && restValue && restValue.__type == 'Pointer') {
    key = '_p_' + key;
  } // Handle atomic values


  var value = transformTopLevelAtom(restValue);

  if (value !== CannotTransform) {
    if (timeField && typeof value === 'string') {
      value = new Date(value);
    }

    if (restKey.indexOf('.') > 0) {
      return {
        key,
        value: restValue
      };
    }

    return {
      key,
      value
    };
  } // Handle arrays


  if (restValue instanceof Array) {
    value = restValue.map(transformInteriorValue);
    return {
      key,
      value
    };
  } // Handle update operators


  if (typeof restValue === 'object' && '__op' in restValue) {
    return {
      key,
      value: transformUpdateOperator(restValue, false)
    };
  } // Handle normal objects by recursing


  value = mapValues(restValue, transformInteriorValue);
  return {
    key,
    value
  };
};

const isRegex = value => {
  return value && value instanceof RegExp;
};

const isStartsWithRegex = value => {
  if (!isRegex(value)) {
    return false;
  }

  const matches = value.toString().match(/\/\^\\Q.*\\E\//);
  return !!matches;
};

const isAllValuesRegexOrNone = values => {
  if (!values || !Array.isArray(values) || values.length === 0) {
    return true;
  }

  const firstValuesIsRegex = isStartsWithRegex(values[0]);

  if (values.length === 1) {
    return firstValuesIsRegex;
  }

  for (let i = 1, length = values.length; i < length; ++i) {
    if (firstValuesIsRegex !== isStartsWithRegex(values[i])) {
      return false;
    }
  }

  return true;
};

const isAnyValueRegex = values => {
  return values.some(function (value) {
    return isRegex(value);
  });
};

const transformInteriorValue = restValue => {
  if (restValue !== null && typeof restValue === 'object' && Object.keys(restValue).some(key => key.includes('$') || key.includes('.'))) {
    throw new Parse.Error(Parse.Error.INVALID_NESTED_KEY, "Nested keys should not contain the '$' or '.' characters");
  } // Handle atomic values


  var value = transformInteriorAtom(restValue);

  if (value !== CannotTransform) {
    return value;
  } // Handle arrays


  if (restValue instanceof Array) {
    return restValue.map(transformInteriorValue);
  } // Handle update operators


  if (typeof restValue === 'object' && '__op' in restValue) {
    return transformUpdateOperator(restValue, true);
  } // Handle normal objects by recursing


  return mapValues(restValue, transformInteriorValue);
};

const valueAsDate = value => {
  if (typeof value === 'string') {
    return new Date(value);
  } else if (value instanceof Date) {
    return value;
  }

  return false;
};

function transformQueryKeyValue(className, key, value, schema) {
  switch (key) {
    case 'createdAt':
      if (valueAsDate(value)) {
        return {
          key: '_created_at',
          value: valueAsDate(value)
        };
      }

      key = '_created_at';
      break;

    case 'updatedAt':
      if (valueAsDate(value)) {
        return {
          key: '_updated_at',
          value: valueAsDate(value)
        };
      }

      key = '_updated_at';
      break;

    case 'expiresAt':
      if (valueAsDate(value)) {
        return {
          key: 'expiresAt',
          value: valueAsDate(value)
        };
      }

      break;

    case '_email_verify_token_expires_at':
      if (valueAsDate(value)) {
        return {
          key: '_email_verify_token_expires_at',
          value: valueAsDate(value)
        };
      }

      break;

    case 'objectId':
      {
        if (className === '_GlobalConfig') {
          value = parseInt(value);
        }

        return {
          key: '_id',
          value
        };
      }

    case '_account_lockout_expires_at':
      if (valueAsDate(value)) {
        return {
          key: '_account_lockout_expires_at',
          value: valueAsDate(value)
        };
      }

      break;

    case '_failed_login_count':
      return {
        key,
        value
      };

    case 'sessionToken':
      return {
        key: '_session_token',
        value
      };

    case '_perishable_token_expires_at':
      if (valueAsDate(value)) {
        return {
          key: '_perishable_token_expires_at',
          value: valueAsDate(value)
        };
      }

      break;

    case '_password_changed_at':
      if (valueAsDate(value)) {
        return {
          key: '_password_changed_at',
          value: valueAsDate(value)
        };
      }

      break;

    case '_rperm':
    case '_wperm':
    case '_perishable_token':
    case '_email_verify_token':
      return {
        key,
        value
      };

    case '$or':
    case '$and':
    case '$nor':
      return {
        key: key,
        value: value.map(subQuery => transformWhere(className, subQuery, schema))
      };

    case 'lastUsed':
      if (valueAsDate(value)) {
        return {
          key: '_last_used',
          value: valueAsDate(value)
        };
      }

      key = '_last_used';
      break;

    case 'timesUsed':
      return {
        key: 'times_used',
        value: value
      };

    default:
      {
        // Other auth data
        const authDataMatch = key.match(/^authData\.([a-zA-Z0-9_]+)\.id$/);

        if (authDataMatch) {
          const provider = authDataMatch[1]; // Special-case auth data.

          return {
            key: `_auth_data_${provider}.id`,
            value
          };
        }
      }
  }

  const expectedTypeIsArray = schema && schema.fields[key] && schema.fields[key].type === 'Array';
  const expectedTypeIsPointer = schema && schema.fields[key] && schema.fields[key].type === 'Pointer';
  const field = schema && schema.fields[key];

  if (expectedTypeIsPointer || !schema && value && value.__type === 'Pointer') {
    key = '_p_' + key;
  } // Handle query constraints


  const transformedConstraint = transformConstraint(value, field);

  if (transformedConstraint !== CannotTransform) {
    if (transformedConstraint.$text) {
      return {
        key: '$text',
        value: transformedConstraint.$text
      };
    }

    if (transformedConstraint.$elemMatch) {
      return {
        key: '$nor',
        value: [{
          [key]: transformedConstraint
        }]
      };
    }

    return {
      key,
      value: transformedConstraint
    };
  }

  if (expectedTypeIsArray && !(value instanceof Array)) {
    return {
      key,
      value: {
        $all: [transformInteriorAtom(value)]
      }
    };
  } // Handle atomic values


  if (transformTopLevelAtom(value) !== CannotTransform) {
    return {
      key,
      value: transformTopLevelAtom(value)
    };
  } else {
    throw new Parse.Error(Parse.Error.INVALID_JSON, `You cannot use ${value} as a query parameter.`);
  }
} // Main exposed method to help run queries.
// restWhere is the "where" clause in REST API form.
// Returns the mongo form of the query.


function transformWhere(className, restWhere, schema) {
  const mongoWhere = {};

  for (const restKey in restWhere) {
    const out = transformQueryKeyValue(className, restKey, restWhere[restKey], schema);
    mongoWhere[out.key] = out.value;
  }

  return mongoWhere;
}

const parseObjectKeyValueToMongoObjectKeyValue = (restKey, restValue, schema) => {
  // Check if the schema is known since it's a built-in field.
  let transformedValue;
  let coercedToDate;

  switch (restKey) {
    case 'objectId':
      return {
        key: '_id',
        value: restValue
      };

    case 'expiresAt':
      transformedValue = transformTopLevelAtom(restValue);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return {
        key: 'expiresAt',
        value: coercedToDate
      };

    case '_email_verify_token_expires_at':
      transformedValue = transformTopLevelAtom(restValue);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return {
        key: '_email_verify_token_expires_at',
        value: coercedToDate
      };

    case '_account_lockout_expires_at':
      transformedValue = transformTopLevelAtom(restValue);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return {
        key: '_account_lockout_expires_at',
        value: coercedToDate
      };

    case '_perishable_token_expires_at':
      transformedValue = transformTopLevelAtom(restValue);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return {
        key: '_perishable_token_expires_at',
        value: coercedToDate
      };

    case '_password_changed_at':
      transformedValue = transformTopLevelAtom(restValue);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return {
        key: '_password_changed_at',
        value: coercedToDate
      };

    case '_failed_login_count':
    case '_rperm':
    case '_wperm':
    case '_email_verify_token':
    case '_hashed_password':
    case '_perishable_token':
      return {
        key: restKey,
        value: restValue
      };

    case 'sessionToken':
      return {
        key: '_session_token',
        value: restValue
      };

    default:
      // Auth data should have been transformed already
      if (restKey.match(/^authData\.([a-zA-Z0-9_]+)\.id$/)) {
        throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'can only query on ' + restKey);
      } // Trust that the auth data has been transformed and save it directly


      if (restKey.match(/^_auth_data_[a-zA-Z0-9_]+$/)) {
        return {
          key: restKey,
          value: restValue
        };
      }

  } //skip straight to transformTopLevelAtom for Bytes, they don't show up in the schema for some reason


  if (restValue && restValue.__type !== 'Bytes') {
    //Note: We may not know the type of a field here, as the user could be saving (null) to a field
    //That never existed before, meaning we can't infer the type.
    if (schema.fields[restKey] && schema.fields[restKey].type == 'Pointer' || restValue.__type == 'Pointer') {
      restKey = '_p_' + restKey;
    }
  } // Handle atomic values


  var value = transformTopLevelAtom(restValue);

  if (value !== CannotTransform) {
    return {
      key: restKey,
      value: value
    };
  } // ACLs are handled before this method is called
  // If an ACL key still exists here, something is wrong.


  if (restKey === 'ACL') {
    throw 'There was a problem transforming an ACL.';
  } // Handle arrays


  if (restValue instanceof Array) {
    value = restValue.map(transformInteriorValue);
    return {
      key: restKey,
      value: value
    };
  } // Handle normal objects by recursing


  if (Object.keys(restValue).some(key => key.includes('$') || key.includes('.'))) {
    throw new Parse.Error(Parse.Error.INVALID_NESTED_KEY, "Nested keys should not contain the '$' or '.' characters");
  }

  value = mapValues(restValue, transformInteriorValue);
  return {
    key: restKey,
    value
  };
};

const parseObjectToMongoObjectForCreate = (className, restCreate, schema) => {
  restCreate = addLegacyACL(restCreate);
  const mongoCreate = {};

  for (const restKey in restCreate) {
    if (restCreate[restKey] && restCreate[restKey].__type === 'Relation') {
      continue;
    }

    const {
      key,
      value
    } = parseObjectKeyValueToMongoObjectKeyValue(restKey, restCreate[restKey], schema);

    if (value !== undefined) {
      mongoCreate[key] = value;
    }
  } // Use the legacy mongo format for createdAt and updatedAt


  if (mongoCreate.createdAt) {
    mongoCreate._created_at = new Date(mongoCreate.createdAt.iso || mongoCreate.createdAt);
    delete mongoCreate.createdAt;
  }

  if (mongoCreate.updatedAt) {
    mongoCreate._updated_at = new Date(mongoCreate.updatedAt.iso || mongoCreate.updatedAt);
    delete mongoCreate.updatedAt;
  }

  return mongoCreate;
}; // Main exposed method to help update old objects.


const transformUpdate = (className, restUpdate, parseFormatSchema) => {
  const mongoUpdate = {};
  const acl = addLegacyACL(restUpdate);

  if (acl._rperm || acl._wperm || acl._acl) {
    mongoUpdate.$set = {};

    if (acl._rperm) {
      mongoUpdate.$set._rperm = acl._rperm;
    }

    if (acl._wperm) {
      mongoUpdate.$set._wperm = acl._wperm;
    }

    if (acl._acl) {
      mongoUpdate.$set._acl = acl._acl;
    }
  }

  for (var restKey in restUpdate) {
    if (restUpdate[restKey] && restUpdate[restKey].__type === 'Relation') {
      continue;
    }

    var out = transformKeyValueForUpdate(className, restKey, restUpdate[restKey], parseFormatSchema); // If the output value is an object with any $ keys, it's an
    // operator that needs to be lifted onto the top level update
    // object.

    if (typeof out.value === 'object' && out.value !== null && out.value.__op) {
      mongoUpdate[out.value.__op] = mongoUpdate[out.value.__op] || {};
      mongoUpdate[out.value.__op][out.key] = out.value.arg;
    } else {
      mongoUpdate['$set'] = mongoUpdate['$set'] || {};
      mongoUpdate['$set'][out.key] = out.value;
    }
  }

  return mongoUpdate;
}; // Add the legacy _acl format.


const addLegacyACL = restObject => {
  const restObjectCopy = _objectSpread({}, restObject);

  const _acl = {};

  if (restObject._wperm) {
    restObject._wperm.forEach(entry => {
      _acl[entry] = {
        w: true
      };
    });

    restObjectCopy._acl = _acl;
  }

  if (restObject._rperm) {
    restObject._rperm.forEach(entry => {
      if (!(entry in _acl)) {
        _acl[entry] = {
          r: true
        };
      } else {
        _acl[entry].r = true;
      }
    });

    restObjectCopy._acl = _acl;
  }

  return restObjectCopy;
}; // A sentinel value that helper transformations return when they
// cannot perform a transformation


function CannotTransform() {}

const transformInteriorAtom = atom => {
  // TODO: check validity harder for the __type-defined types
  if (typeof atom === 'object' && atom && !(atom instanceof Date) && atom.__type === 'Pointer') {
    return {
      __type: 'Pointer',
      className: atom.className,
      objectId: atom.objectId
    };
  } else if (typeof atom === 'function' || typeof atom === 'symbol') {
    throw new Parse.Error(Parse.Error.INVALID_JSON, `cannot transform value: ${atom}`);
  } else if (DateCoder.isValidJSON(atom)) {
    return DateCoder.JSONToDatabase(atom);
  } else if (BytesCoder.isValidJSON(atom)) {
    return BytesCoder.JSONToDatabase(atom);
  } else if (typeof atom === 'object' && atom && atom.$regex !== undefined) {
    return new RegExp(atom.$regex);
  } else {
    return atom;
  }
}; // Helper function to transform an atom from REST format to Mongo format.
// An atom is anything that can't contain other expressions. So it
// includes things where objects are used to represent other
// datatypes, like pointers and dates, but it does not include objects
// or arrays with generic stuff inside.
// Raises an error if this cannot possibly be valid REST format.
// Returns CannotTransform if it's just not an atom


function transformTopLevelAtom(atom, field) {
  switch (typeof atom) {
    case 'number':
    case 'boolean':
    case 'undefined':
      return atom;

    case 'string':
      if (field && field.type === 'Pointer') {
        return `${field.targetClass}$${atom}`;
      }

      return atom;

    case 'symbol':
    case 'function':
      throw new Parse.Error(Parse.Error.INVALID_JSON, `cannot transform value: ${atom}`);

    case 'object':
      if (atom instanceof Date) {
        // Technically dates are not rest format, but, it seems pretty
        // clear what they should be transformed to, so let's just do it.
        return atom;
      }

      if (atom === null) {
        return atom;
      } // TODO: check validity harder for the __type-defined types


      if (atom.__type == 'Pointer') {
        return `${atom.className}$${atom.objectId}`;
      }

      if (DateCoder.isValidJSON(atom)) {
        return DateCoder.JSONToDatabase(atom);
      }

      if (BytesCoder.isValidJSON(atom)) {
        return BytesCoder.JSONToDatabase(atom);
      }

      if (GeoPointCoder.isValidJSON(atom)) {
        return GeoPointCoder.JSONToDatabase(atom);
      }

      if (PolygonCoder.isValidJSON(atom)) {
        return PolygonCoder.JSONToDatabase(atom);
      }

      if (FileCoder.isValidJSON(atom)) {
        return FileCoder.JSONToDatabase(atom);
      }

      return CannotTransform;

    default:
      // I don't think typeof can ever let us get here
      throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, `really did not expect value: ${atom}`);
  }
}

function relativeTimeToDate(text, now = new Date()) {
  text = text.toLowerCase();
  let parts = text.split(' '); // Filter out whitespace

  parts = parts.filter(part => part !== '');
  const future = parts[0] === 'in';
  const past = parts[parts.length - 1] === 'ago';

  if (!future && !past && text !== 'now') {
    return {
      status: 'error',
      info: "Time should either start with 'in' or end with 'ago'"
    };
  }

  if (future && past) {
    return {
      status: 'error',
      info: "Time cannot have both 'in' and 'ago'"
    };
  } // strip the 'ago' or 'in'


  if (future) {
    parts = parts.slice(1);
  } else {
    // past
    parts = parts.slice(0, parts.length - 1);
  }

  if (parts.length % 2 !== 0 && text !== 'now') {
    return {
      status: 'error',
      info: 'Invalid time string. Dangling unit or number.'
    };
  }

  const pairs = [];

  while (parts.length) {
    pairs.push([parts.shift(), parts.shift()]);
  }

  let seconds = 0;

  for (const [num, interval] of pairs) {
    const val = Number(num);

    if (!Number.isInteger(val)) {
      return {
        status: 'error',
        info: `'${num}' is not an integer.`
      };
    }

    switch (interval) {
      case 'yr':
      case 'yrs':
      case 'year':
      case 'years':
        seconds += val * 31536000; // 365 * 24 * 60 * 60

        break;

      case 'wk':
      case 'wks':
      case 'week':
      case 'weeks':
        seconds += val * 604800; // 7 * 24 * 60 * 60

        break;

      case 'd':
      case 'day':
      case 'days':
        seconds += val * 86400; // 24 * 60 * 60

        break;

      case 'hr':
      case 'hrs':
      case 'hour':
      case 'hours':
        seconds += val * 3600; // 60 * 60

        break;

      case 'min':
      case 'mins':
      case 'minute':
      case 'minutes':
        seconds += val * 60;
        break;

      case 'sec':
      case 'secs':
      case 'second':
      case 'seconds':
        seconds += val;
        break;

      default:
        return {
          status: 'error',
          info: `Invalid interval: '${interval}'`
        };
    }
  }

  const milliseconds = seconds * 1000;

  if (future) {
    return {
      status: 'success',
      info: 'future',
      result: new Date(now.valueOf() + milliseconds)
    };
  } else if (past) {
    return {
      status: 'success',
      info: 'past',
      result: new Date(now.valueOf() - milliseconds)
    };
  } else {
    return {
      status: 'success',
      info: 'present',
      result: new Date(now.valueOf())
    };
  }
} // Transforms a query constraint from REST API format to Mongo format.
// A constraint is something with fields like $lt.
// If it is not a valid constraint but it could be a valid something
// else, return CannotTransform.
// inArray is whether this is an array field.


function transformConstraint(constraint, field) {
  const inArray = field && field.type && field.type === 'Array';

  if (typeof constraint !== 'object' || !constraint) {
    return CannotTransform;
  }

  const transformFunction = inArray ? transformInteriorAtom : transformTopLevelAtom;

  const transformer = atom => {
    const result = transformFunction(atom, field);

    if (result === CannotTransform) {
      throw new Parse.Error(Parse.Error.INVALID_JSON, `bad atom: ${JSON.stringify(atom)}`);
    }

    return result;
  }; // keys is the constraints in reverse alphabetical order.
  // This is a hack so that:
  //   $regex is handled before $options
  //   $nearSphere is handled before $maxDistance


  var keys = Object.keys(constraint).sort().reverse();
  var answer = {};

  for (var key of keys) {
    switch (key) {
      case '$lt':
      case '$lte':
      case '$gt':
      case '$gte':
      case '$exists':
      case '$ne':
      case '$eq':
        {
          const val = constraint[key];

          if (val && typeof val === 'object' && val.$relativeTime) {
            if (field && field.type !== 'Date') {
              throw new Parse.Error(Parse.Error.INVALID_JSON, '$relativeTime can only be used with Date field');
            }

            switch (key) {
              case '$exists':
              case '$ne':
              case '$eq':
                throw new Parse.Error(Parse.Error.INVALID_JSON, '$relativeTime can only be used with the $lt, $lte, $gt, and $gte operators');
            }

            const parserResult = relativeTimeToDate(val.$relativeTime);

            if (parserResult.status === 'success') {
              answer[key] = parserResult.result;
              break;
            }

            _logger.default.info('Error while parsing relative date', parserResult);

            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $relativeTime (${key}) value. ${parserResult.info}`);
          }

          answer[key] = transformer(val);
          break;
        }

      case '$in':
      case '$nin':
        {
          const arr = constraint[key];

          if (!(arr instanceof Array)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad ' + key + ' value');
          }

          answer[key] = _lodash.default.flatMap(arr, value => {
            return (atom => {
              if (Array.isArray(atom)) {
                return value.map(transformer);
              } else {
                return transformer(atom);
              }
            })(value);
          });
          break;
        }

      case '$all':
        {
          const arr = constraint[key];

          if (!(arr instanceof Array)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad ' + key + ' value');
          }

          answer[key] = arr.map(transformInteriorAtom);
          const values = answer[key];

          if (isAnyValueRegex(values) && !isAllValuesRegexOrNone(values)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, 'All $all values must be of regex type or none: ' + values);
          }

          break;
        }

      case '$regex':
        var s = constraint[key];

        if (typeof s !== 'string') {
          throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad regex: ' + s);
        }

        answer[key] = s;
        break;

      case '$containedBy':
        {
          const arr = constraint[key];

          if (!(arr instanceof Array)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $containedBy: should be an array`);
          }

          answer.$elemMatch = {
            $nin: arr.map(transformer)
          };
          break;
        }

      case '$options':
        answer[key] = constraint[key];
        break;

      case '$text':
        {
          const search = constraint[key].$search;

          if (typeof search !== 'object') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $text: $search, should be object`);
          }

          if (!search.$term || typeof search.$term !== 'string') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $text: $term, should be string`);
          } else {
            answer[key] = {
              $search: search.$term
            };
          }

          if (search.$language && typeof search.$language !== 'string') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $text: $language, should be string`);
          } else if (search.$language) {
            answer[key].$language = search.$language;
          }

          if (search.$caseSensitive && typeof search.$caseSensitive !== 'boolean') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $text: $caseSensitive, should be boolean`);
          } else if (search.$caseSensitive) {
            answer[key].$caseSensitive = search.$caseSensitive;
          }

          if (search.$diacriticSensitive && typeof search.$diacriticSensitive !== 'boolean') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $text: $diacriticSensitive, should be boolean`);
          } else if (search.$diacriticSensitive) {
            answer[key].$diacriticSensitive = search.$diacriticSensitive;
          }

          break;
        }

      case '$nearSphere':
        var point = constraint[key];
        answer[key] = [point.longitude, point.latitude];
        break;

      case '$maxDistance':
        answer[key] = constraint[key];
        break;
      // The SDKs don't seem to use these but they are documented in the
      // REST API docs.

      case '$maxDistanceInRadians':
        answer['$maxDistance'] = constraint[key];
        break;

      case '$maxDistanceInMiles':
        answer['$maxDistance'] = constraint[key] / 3959;
        break;

      case '$maxDistanceInKilometers':
        answer['$maxDistance'] = constraint[key] / 6371;
        break;

      case '$select':
      case '$dontSelect':
        throw new Parse.Error(Parse.Error.COMMAND_UNAVAILABLE, 'the ' + key + ' constraint is not supported yet');

      case '$within':
        var box = constraint[key]['$box'];

        if (!box || box.length != 2) {
          throw new Parse.Error(Parse.Error.INVALID_JSON, 'malformatted $within arg');
        }

        answer[key] = {
          $box: [[box[0].longitude, box[0].latitude], [box[1].longitude, box[1].latitude]]
        };
        break;

      case '$geoWithin':
        {
          const polygon = constraint[key]['$polygon'];
          const centerSphere = constraint[key]['$centerSphere'];

          if (polygon !== undefined) {
            let points;

            if (typeof polygon === 'object' && polygon.__type === 'Polygon') {
              if (!polygon.coordinates || polygon.coordinates.length < 3) {
                throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value; Polygon.coordinates should contain at least 3 lon/lat pairs');
              }

              points = polygon.coordinates;
            } else if (polygon instanceof Array) {
              if (polygon.length < 3) {
                throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value; $polygon should contain at least 3 GeoPoints');
              }

              points = polygon;
            } else {
              throw new Parse.Error(Parse.Error.INVALID_JSON, "bad $geoWithin value; $polygon should be Polygon object or Array of Parse.GeoPoint's");
            }

            points = points.map(point => {
              if (point instanceof Array && point.length === 2) {
                Parse.GeoPoint._validate(point[1], point[0]);

                return point;
              }

              if (!GeoPointCoder.isValidJSON(point)) {
                throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value');
              } else {
                Parse.GeoPoint._validate(point.latitude, point.longitude);
              }

              return [point.longitude, point.latitude];
            });
            answer[key] = {
              $polygon: points
            };
          } else if (centerSphere !== undefined) {
            if (!(centerSphere instanceof Array) || centerSphere.length < 2) {
              throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere should be an array of Parse.GeoPoint and distance');
            } // Get point, convert to geo point if necessary and validate


            let point = centerSphere[0];

            if (point instanceof Array && point.length === 2) {
              point = new Parse.GeoPoint(point[1], point[0]);
            } else if (!GeoPointCoder.isValidJSON(point)) {
              throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere geo point invalid');
            }

            Parse.GeoPoint._validate(point.latitude, point.longitude); // Get distance and validate


            const distance = centerSphere[1];

            if (isNaN(distance) || distance < 0) {
              throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere distance invalid');
            }

            answer[key] = {
              $centerSphere: [[point.longitude, point.latitude], distance]
            };
          }

          break;
        }

      case '$geoIntersects':
        {
          const point = constraint[key]['$point'];

          if (!GeoPointCoder.isValidJSON(point)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoIntersect value; $point should be GeoPoint');
          } else {
            Parse.GeoPoint._validate(point.latitude, point.longitude);
          }

          answer[key] = {
            $geometry: {
              type: 'Point',
              coordinates: [point.longitude, point.latitude]
            }
          };
          break;
        }

      default:
        if (key.match(/^\$+/)) {
          throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad constraint: ' + key);
        }

        return CannotTransform;
    }
  }

  return answer;
} // Transforms an update operator from REST format to mongo format.
// To be transformed, the input should have an __op field.
// If flatten is true, this will flatten operators to their static
// data format. For example, an increment of 2 would simply become a
// 2.
// The output for a non-flattened operator is a hash with __op being
// the mongo op, and arg being the argument.
// The output for a flattened operator is just a value.
// Returns undefined if this should be a no-op.


function transformUpdateOperator({
  __op,
  amount,
  objects
}, flatten) {
  switch (__op) {
    case 'Delete':
      if (flatten) {
        return undefined;
      } else {
        return {
          __op: '$unset',
          arg: ''
        };
      }

    case 'Increment':
      if (typeof amount !== 'number') {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'incrementing must provide a number');
      }

      if (flatten) {
        return amount;
      } else {
        return {
          __op: '$inc',
          arg: amount
        };
      }

    case 'Add':
    case 'AddUnique':
      if (!(objects instanceof Array)) {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'objects to add must be an array');
      }

      var toAdd = objects.map(transformInteriorAtom);

      if (flatten) {
        return toAdd;
      } else {
        var mongoOp = {
          Add: '$push',
          AddUnique: '$addToSet'
        }[__op];
        return {
          __op: mongoOp,
          arg: {
            $each: toAdd
          }
        };
      }

    case 'Remove':
      if (!(objects instanceof Array)) {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'objects to remove must be an array');
      }

      var toRemove = objects.map(transformInteriorAtom);

      if (flatten) {
        return [];
      } else {
        return {
          __op: '$pullAll',
          arg: toRemove
        };
      }

    default:
      throw new Parse.Error(Parse.Error.COMMAND_UNAVAILABLE, `The ${__op} operator is not supported yet.`);
  }
}

function mapValues(object, iterator) {
  const result = {};
  Object.keys(object).forEach(key => {
    result[key] = iterator(object[key]);
  });
  return result;
}

const nestedMongoObjectToNestedParseObject = mongoObject => {
  switch (typeof mongoObject) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'undefined':
      return mongoObject;

    case 'symbol':
    case 'function':
      throw 'bad value in nestedMongoObjectToNestedParseObject';

    case 'object':
      if (mongoObject === null) {
        return null;
      }

      if (mongoObject instanceof Array) {
        return mongoObject.map(nestedMongoObjectToNestedParseObject);
      }

      if (mongoObject instanceof Date) {
        return Parse._encode(mongoObject);
      }

      if (mongoObject instanceof mongodb.Long) {
        return mongoObject.toNumber();
      }

      if (mongoObject instanceof mongodb.Double) {
        return mongoObject.value;
      }

      if (BytesCoder.isValidDatabaseObject(mongoObject)) {
        return BytesCoder.databaseToJSON(mongoObject);
      }

      if (mongoObject.hasOwnProperty('__type') && mongoObject.__type == 'Date' && mongoObject.iso instanceof Date) {
        mongoObject.iso = mongoObject.iso.toJSON();
        return mongoObject;
      }

      return mapValues(mongoObject, nestedMongoObjectToNestedParseObject);

    default:
      throw 'unknown js type';
  }
};

const transformPointerString = (schema, field, pointerString) => {
  const objData = pointerString.split('$');

  if (objData[0] !== schema.fields[field].targetClass) {
    throw 'pointer to incorrect className';
  }

  return {
    __type: 'Pointer',
    className: objData[0],
    objectId: objData[1]
  };
}; // Converts from a mongo-format object to a REST-format object.
// Does not strip out anything based on a lack of authentication.


const mongoObjectToParseObject = (className, mongoObject, schema) => {
  switch (typeof mongoObject) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'undefined':
      return mongoObject;

    case 'symbol':
    case 'function':
      throw 'bad value in mongoObjectToParseObject';

    case 'object':
      {
        if (mongoObject === null) {
          return null;
        }

        if (mongoObject instanceof Array) {
          return mongoObject.map(nestedMongoObjectToNestedParseObject);
        }

        if (mongoObject instanceof Date) {
          return Parse._encode(mongoObject);
        }

        if (mongoObject instanceof mongodb.Long) {
          return mongoObject.toNumber();
        }

        if (mongoObject instanceof mongodb.Double) {
          return mongoObject.value;
        }

        if (BytesCoder.isValidDatabaseObject(mongoObject)) {
          return BytesCoder.databaseToJSON(mongoObject);
        }

        const restObject = {};

        if (mongoObject._rperm || mongoObject._wperm) {
          restObject._rperm = mongoObject._rperm || [];
          restObject._wperm = mongoObject._wperm || [];
          delete mongoObject._rperm;
          delete mongoObject._wperm;
        }

        for (var key in mongoObject) {
          switch (key) {
            case '_id':
              restObject['objectId'] = '' + mongoObject[key];
              break;

            case '_hashed_password':
              restObject._hashed_password = mongoObject[key];
              break;

            case '_acl':
              break;

            case '_email_verify_token':
            case '_perishable_token':
            case '_perishable_token_expires_at':
            case '_password_changed_at':
            case '_tombstone':
            case '_email_verify_token_expires_at':
            case '_account_lockout_expires_at':
            case '_failed_login_count':
            case '_password_history':
              // Those keys will be deleted if needed in the DB Controller
              restObject[key] = mongoObject[key];
              break;

            case '_session_token':
              restObject['sessionToken'] = mongoObject[key];
              break;

            case 'updatedAt':
            case '_updated_at':
              restObject['updatedAt'] = Parse._encode(new Date(mongoObject[key])).iso;
              break;

            case 'createdAt':
            case '_created_at':
              restObject['createdAt'] = Parse._encode(new Date(mongoObject[key])).iso;
              break;

            case 'expiresAt':
            case '_expiresAt':
              restObject['expiresAt'] = Parse._encode(new Date(mongoObject[key]));
              break;

            case 'lastUsed':
            case '_last_used':
              restObject['lastUsed'] = Parse._encode(new Date(mongoObject[key])).iso;
              break;

            case 'timesUsed':
            case 'times_used':
              restObject['timesUsed'] = mongoObject[key];
              break;

            default:
              // Check other auth data keys
              var authDataMatch = key.match(/^_auth_data_([a-zA-Z0-9_]+)$/);

              if (authDataMatch) {
                var provider = authDataMatch[1];
                restObject['authData'] = restObject['authData'] || {};
                restObject['authData'][provider] = mongoObject[key];
                break;
              }

              if (key.indexOf('_p_') == 0) {
                var newKey = key.substring(3);

                if (!schema.fields[newKey]) {
                  _logger.default.info('transform.js', 'Found a pointer column not in the schema, dropping it.', className, newKey);

                  break;
                }

                if (schema.fields[newKey].type !== 'Pointer') {
                  _logger.default.info('transform.js', 'Found a pointer in a non-pointer column, dropping it.', className, key);

                  break;
                }

                if (mongoObject[key] === null) {
                  break;
                }

                restObject[newKey] = transformPointerString(schema, newKey, mongoObject[key]);
                break;
              } else if (key[0] == '_' && key != '__type') {
                throw 'bad key in untransform: ' + key;
              } else {
                var value = mongoObject[key];

                if (schema.fields[key] && schema.fields[key].type === 'File' && FileCoder.isValidDatabaseObject(value)) {
                  restObject[key] = FileCoder.databaseToJSON(value);
                  break;
                }

                if (schema.fields[key] && schema.fields[key].type === 'GeoPoint' && GeoPointCoder.isValidDatabaseObject(value)) {
                  restObject[key] = GeoPointCoder.databaseToJSON(value);
                  break;
                }

                if (schema.fields[key] && schema.fields[key].type === 'Polygon' && PolygonCoder.isValidDatabaseObject(value)) {
                  restObject[key] = PolygonCoder.databaseToJSON(value);
                  break;
                }

                if (schema.fields[key] && schema.fields[key].type === 'Bytes' && BytesCoder.isValidDatabaseObject(value)) {
                  restObject[key] = BytesCoder.databaseToJSON(value);
                  break;
                }
              }

              restObject[key] = nestedMongoObjectToNestedParseObject(mongoObject[key]);
          }
        }

        const relationFieldNames = Object.keys(schema.fields).filter(fieldName => schema.fields[fieldName].type === 'Relation');
        const relationFields = {};
        relationFieldNames.forEach(relationFieldName => {
          relationFields[relationFieldName] = {
            __type: 'Relation',
            className: schema.fields[relationFieldName].targetClass
          };
        });
        return _objectSpread({}, restObject, relationFields);
      }

    default:
      throw 'unknown js type';
  }
};

var DateCoder = {
  JSONToDatabase(json) {
    return new Date(json.iso);
  },

  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'Date';
  }

};
var BytesCoder = {
  base64Pattern: new RegExp('^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'),

  isBase64Value(object) {
    if (typeof object !== 'string') {
      return false;
    }

    return this.base64Pattern.test(object);
  },

  databaseToJSON(object) {
    let value;

    if (this.isBase64Value(object)) {
      value = object;
    } else {
      value = object.buffer.toString('base64');
    }

    return {
      __type: 'Bytes',
      base64: value
    };
  },

  isValidDatabaseObject(object) {
    return object instanceof mongodb.Binary || this.isBase64Value(object);
  },

  JSONToDatabase(json) {
    return new mongodb.Binary(new Buffer(json.base64, 'base64'));
  },

  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'Bytes';
  }

};
var GeoPointCoder = {
  databaseToJSON(object) {
    return {
      __type: 'GeoPoint',
      latitude: object[1],
      longitude: object[0]
    };
  },

  isValidDatabaseObject(object) {
    return object instanceof Array && object.length == 2;
  },

  JSONToDatabase(json) {
    return [json.longitude, json.latitude];
  },

  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'GeoPoint';
  }

};
var PolygonCoder = {
  databaseToJSON(object) {
    // Convert lng/lat -> lat/lng
    const coords = object.coordinates[0].map(coord => {
      return [coord[1], coord[0]];
    });
    return {
      __type: 'Polygon',
      coordinates: coords
    };
  },

  isValidDatabaseObject(object) {
    const coords = object.coordinates[0];

    if (object.type !== 'Polygon' || !(coords instanceof Array)) {
      return false;
    }

    for (let i = 0; i < coords.length; i++) {
      const point = coords[i];

      if (!GeoPointCoder.isValidDatabaseObject(point)) {
        return false;
      }

      Parse.GeoPoint._validate(parseFloat(point[1]), parseFloat(point[0]));
    }

    return true;
  },

  JSONToDatabase(json) {
    let coords = json.coordinates; // Add first point to the end to close polygon

    if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
      coords.push(coords[0]);
    }

    const unique = coords.filter((item, index, ar) => {
      let foundIndex = -1;

      for (let i = 0; i < ar.length; i += 1) {
        const pt = ar[i];

        if (pt[0] === item[0] && pt[1] === item[1]) {
          foundIndex = i;
          break;
        }
      }

      return foundIndex === index;
    });

    if (unique.length < 3) {
      throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'GeoJSON: Loop must have at least 3 different vertices');
    } // Convert lat/long -> long/lat


    coords = coords.map(coord => {
      return [coord[1], coord[0]];
    });
    return {
      type: 'Polygon',
      coordinates: [coords]
    };
  },

  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'Polygon';
  }

};
var FileCoder = {
  databaseToJSON(object) {
    return {
      __type: 'File',
      name: object
    };
  },

  isValidDatabaseObject(object) {
    return typeof object === 'string';
  },

  JSONToDatabase(json) {
    return json.name;
  },

  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'File';
  }

};
module.exports = {
  transformKey,
  parseObjectToMongoObjectForCreate,
  transformUpdate,
  transformWhere,
  mongoObjectToParseObject,
  relativeTimeToDate,
  transformConstraint,
  transformPointerString
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9BZGFwdGVycy9TdG9yYWdlL01vbmdvL01vbmdvVHJhbnNmb3JtLmpzIl0sIm5hbWVzIjpbIm1vbmdvZGIiLCJyZXF1aXJlIiwiUGFyc2UiLCJ0cmFuc2Zvcm1LZXkiLCJjbGFzc05hbWUiLCJmaWVsZE5hbWUiLCJzY2hlbWEiLCJmaWVsZHMiLCJfX3R5cGUiLCJ0eXBlIiwidHJhbnNmb3JtS2V5VmFsdWVGb3JVcGRhdGUiLCJyZXN0S2V5IiwicmVzdFZhbHVlIiwicGFyc2VGb3JtYXRTY2hlbWEiLCJrZXkiLCJ0aW1lRmllbGQiLCJ2YWx1ZSIsInBhcnNlSW50IiwidHJhbnNmb3JtVG9wTGV2ZWxBdG9tIiwiQ2Fubm90VHJhbnNmb3JtIiwiRGF0ZSIsImluZGV4T2YiLCJBcnJheSIsIm1hcCIsInRyYW5zZm9ybUludGVyaW9yVmFsdWUiLCJ0cmFuc2Zvcm1VcGRhdGVPcGVyYXRvciIsIm1hcFZhbHVlcyIsImlzUmVnZXgiLCJSZWdFeHAiLCJpc1N0YXJ0c1dpdGhSZWdleCIsIm1hdGNoZXMiLCJ0b1N0cmluZyIsIm1hdGNoIiwiaXNBbGxWYWx1ZXNSZWdleE9yTm9uZSIsInZhbHVlcyIsImlzQXJyYXkiLCJsZW5ndGgiLCJmaXJzdFZhbHVlc0lzUmVnZXgiLCJpIiwiaXNBbnlWYWx1ZVJlZ2V4Iiwic29tZSIsIk9iamVjdCIsImtleXMiLCJpbmNsdWRlcyIsIkVycm9yIiwiSU5WQUxJRF9ORVNURURfS0VZIiwidHJhbnNmb3JtSW50ZXJpb3JBdG9tIiwidmFsdWVBc0RhdGUiLCJ0cmFuc2Zvcm1RdWVyeUtleVZhbHVlIiwic3ViUXVlcnkiLCJ0cmFuc2Zvcm1XaGVyZSIsImF1dGhEYXRhTWF0Y2giLCJwcm92aWRlciIsImV4cGVjdGVkVHlwZUlzQXJyYXkiLCJleHBlY3RlZFR5cGVJc1BvaW50ZXIiLCJmaWVsZCIsInRyYW5zZm9ybWVkQ29uc3RyYWludCIsInRyYW5zZm9ybUNvbnN0cmFpbnQiLCIkdGV4dCIsIiRlbGVtTWF0Y2giLCIkYWxsIiwiSU5WQUxJRF9KU09OIiwicmVzdFdoZXJlIiwibW9uZ29XaGVyZSIsIm91dCIsInBhcnNlT2JqZWN0S2V5VmFsdWVUb01vbmdvT2JqZWN0S2V5VmFsdWUiLCJ0cmFuc2Zvcm1lZFZhbHVlIiwiY29lcmNlZFRvRGF0ZSIsIklOVkFMSURfS0VZX05BTUUiLCJwYXJzZU9iamVjdFRvTW9uZ29PYmplY3RGb3JDcmVhdGUiLCJyZXN0Q3JlYXRlIiwiYWRkTGVnYWN5QUNMIiwibW9uZ29DcmVhdGUiLCJ1bmRlZmluZWQiLCJjcmVhdGVkQXQiLCJfY3JlYXRlZF9hdCIsImlzbyIsInVwZGF0ZWRBdCIsIl91cGRhdGVkX2F0IiwidHJhbnNmb3JtVXBkYXRlIiwicmVzdFVwZGF0ZSIsIm1vbmdvVXBkYXRlIiwiYWNsIiwiX3JwZXJtIiwiX3dwZXJtIiwiX2FjbCIsIiRzZXQiLCJfX29wIiwiYXJnIiwicmVzdE9iamVjdCIsInJlc3RPYmplY3RDb3B5IiwiZm9yRWFjaCIsImVudHJ5IiwidyIsInIiLCJhdG9tIiwib2JqZWN0SWQiLCJEYXRlQ29kZXIiLCJpc1ZhbGlkSlNPTiIsIkpTT05Ub0RhdGFiYXNlIiwiQnl0ZXNDb2RlciIsIiRyZWdleCIsInRhcmdldENsYXNzIiwiR2VvUG9pbnRDb2RlciIsIlBvbHlnb25Db2RlciIsIkZpbGVDb2RlciIsIklOVEVSTkFMX1NFUlZFUl9FUlJPUiIsInJlbGF0aXZlVGltZVRvRGF0ZSIsInRleHQiLCJub3ciLCJ0b0xvd2VyQ2FzZSIsInBhcnRzIiwic3BsaXQiLCJmaWx0ZXIiLCJwYXJ0IiwiZnV0dXJlIiwicGFzdCIsInN0YXR1cyIsImluZm8iLCJzbGljZSIsInBhaXJzIiwicHVzaCIsInNoaWZ0Iiwic2Vjb25kcyIsIm51bSIsImludGVydmFsIiwidmFsIiwiTnVtYmVyIiwiaXNJbnRlZ2VyIiwibWlsbGlzZWNvbmRzIiwicmVzdWx0IiwidmFsdWVPZiIsImNvbnN0cmFpbnQiLCJpbkFycmF5IiwidHJhbnNmb3JtRnVuY3Rpb24iLCJ0cmFuc2Zvcm1lciIsIkpTT04iLCJzdHJpbmdpZnkiLCJzb3J0IiwicmV2ZXJzZSIsImFuc3dlciIsIiRyZWxhdGl2ZVRpbWUiLCJwYXJzZXJSZXN1bHQiLCJsb2ciLCJhcnIiLCJfIiwiZmxhdE1hcCIsInMiLCIkbmluIiwic2VhcmNoIiwiJHNlYXJjaCIsIiR0ZXJtIiwiJGxhbmd1YWdlIiwiJGNhc2VTZW5zaXRpdmUiLCIkZGlhY3JpdGljU2Vuc2l0aXZlIiwicG9pbnQiLCJsb25naXR1ZGUiLCJsYXRpdHVkZSIsIkNPTU1BTkRfVU5BVkFJTEFCTEUiLCJib3giLCIkYm94IiwicG9seWdvbiIsImNlbnRlclNwaGVyZSIsInBvaW50cyIsImNvb3JkaW5hdGVzIiwiR2VvUG9pbnQiLCJfdmFsaWRhdGUiLCIkcG9seWdvbiIsImRpc3RhbmNlIiwiaXNOYU4iLCIkY2VudGVyU3BoZXJlIiwiJGdlb21ldHJ5IiwiYW1vdW50Iiwib2JqZWN0cyIsImZsYXR0ZW4iLCJ0b0FkZCIsIm1vbmdvT3AiLCJBZGQiLCJBZGRVbmlxdWUiLCIkZWFjaCIsInRvUmVtb3ZlIiwib2JqZWN0IiwiaXRlcmF0b3IiLCJuZXN0ZWRNb25nb09iamVjdFRvTmVzdGVkUGFyc2VPYmplY3QiLCJtb25nb09iamVjdCIsIl9lbmNvZGUiLCJMb25nIiwidG9OdW1iZXIiLCJEb3VibGUiLCJpc1ZhbGlkRGF0YWJhc2VPYmplY3QiLCJkYXRhYmFzZVRvSlNPTiIsImhhc093blByb3BlcnR5IiwidG9KU09OIiwidHJhbnNmb3JtUG9pbnRlclN0cmluZyIsInBvaW50ZXJTdHJpbmciLCJvYmpEYXRhIiwibW9uZ29PYmplY3RUb1BhcnNlT2JqZWN0IiwiX2hhc2hlZF9wYXNzd29yZCIsIm5ld0tleSIsInN1YnN0cmluZyIsInJlbGF0aW9uRmllbGROYW1lcyIsInJlbGF0aW9uRmllbGRzIiwicmVsYXRpb25GaWVsZE5hbWUiLCJqc29uIiwiYmFzZTY0UGF0dGVybiIsImlzQmFzZTY0VmFsdWUiLCJ0ZXN0IiwiYnVmZmVyIiwiYmFzZTY0IiwiQmluYXJ5IiwiQnVmZmVyIiwiY29vcmRzIiwiY29vcmQiLCJwYXJzZUZsb2F0IiwidW5pcXVlIiwiaXRlbSIsImluZGV4IiwiYXIiLCJmb3VuZEluZGV4IiwicHQiLCJuYW1lIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJtYXBwaW5ncyI6Ijs7QUFBQTs7QUFDQTs7Ozs7Ozs7QUFDQSxJQUFJQSxPQUFPLEdBQUdDLE9BQU8sQ0FBQyxTQUFELENBQXJCOztBQUNBLElBQUlDLEtBQUssR0FBR0QsT0FBTyxDQUFDLFlBQUQsQ0FBUCxDQUFzQkMsS0FBbEM7O0FBRUEsTUFBTUMsWUFBWSxHQUFHLENBQUNDLFNBQUQsRUFBWUMsU0FBWixFQUF1QkMsTUFBdkIsS0FBa0M7QUFDckQ7QUFDQSxVQUFRRCxTQUFSO0FBQ0UsU0FBSyxVQUFMO0FBQ0UsYUFBTyxLQUFQOztBQUNGLFNBQUssV0FBTDtBQUNFLGFBQU8sYUFBUDs7QUFDRixTQUFLLFdBQUw7QUFDRSxhQUFPLGFBQVA7O0FBQ0YsU0FBSyxjQUFMO0FBQ0UsYUFBTyxnQkFBUDs7QUFDRixTQUFLLFVBQUw7QUFDRSxhQUFPLFlBQVA7O0FBQ0YsU0FBSyxXQUFMO0FBQ0UsYUFBTyxZQUFQO0FBWko7O0FBZUEsTUFDRUMsTUFBTSxDQUFDQyxNQUFQLENBQWNGLFNBQWQsS0FDQUMsTUFBTSxDQUFDQyxNQUFQLENBQWNGLFNBQWQsRUFBeUJHLE1BQXpCLElBQW1DLFNBRnJDLEVBR0U7QUFDQUgsSUFBQUEsU0FBUyxHQUFHLFFBQVFBLFNBQXBCO0FBQ0QsR0FMRCxNQUtPLElBQ0xDLE1BQU0sQ0FBQ0MsTUFBUCxDQUFjRixTQUFkLEtBQ0FDLE1BQU0sQ0FBQ0MsTUFBUCxDQUFjRixTQUFkLEVBQXlCSSxJQUF6QixJQUFpQyxTQUY1QixFQUdMO0FBQ0FKLElBQUFBLFNBQVMsR0FBRyxRQUFRQSxTQUFwQjtBQUNEOztBQUVELFNBQU9BLFNBQVA7QUFDRCxDQTlCRDs7QUFnQ0EsTUFBTUssMEJBQTBCLEdBQUcsQ0FDakNOLFNBRGlDLEVBRWpDTyxPQUZpQyxFQUdqQ0MsU0FIaUMs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WWRsRixFQUFBQSxjQUFjLENBQUN3RyxJQUFELEVBQU87QUFDbkIsV0FBT0EsSUFBSSxDQUFDaUIsSUFBWjtBQUNELEdBZGE7O0FBZ0JkMUgsRUFBQUEsV0FBVyxDQUFDbEYsS0FBRCxFQUFRO0FBQ2pCLFdBQ0UsT0FBT0EsS0FBUCxLQUFpQixRQUFqQixJQUE2QkEsS0FBSyxLQUFLLElBQXZDLElBQStDQSxLQUFLLENBQUNSLE1BQU4sS0FBaUIsTUFEbEU7QUFHRDs7QUFwQmEsQ0FBaEI7QUF1QkFxTixNQUFNLENBQUNDLE9BQVAsR0FBaUI7QUFDZjNOLEVBQUFBLFlBRGU7QUFFZmtFLEVBQUFBLGlDQUZlO0FBR2ZVLEVBQUFBLGVBSGU7QUFJZjdCLEVBQUFBLGNBSmU7QUFLZmtKLEVBQUFBLHdCQUxlO0FBTWZ6RixFQUFBQSxrQkFOZTtBQU9mbEQsRUFBQUEsbUJBUGU7QUFRZndJLEVBQUFBO0FBUmUsQ0FBakIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgbG9nIGZyb20gJy4uLy4uLy4uL2xvZ2dlcic7XG5pbXBvcnQgXyBmcm9tICdsb2Rhc2gnO1xudmFyIG1vbmdvZGIgPSByZXF1aXJlKCdtb25nb2RiJyk7XG52YXIgUGFyc2UgPSByZXF1aXJlKCdwYXJzZS9ub2RlJykuUGFyc2U7XG5cbmNvbnN0IHRyYW5zZm9ybUtleSA9IChjbGFzc05hbWUsIGZpZWxkTmFtZSwgc2NoZW1hKSA9PiB7XG4gIC8vIENoZWNrIGlmIHRoZSBzY2hlbWEgaXMga25vd24gc2luY2UgaXQncyBhIGJ1aWx0LWluIGZpZWxkLlxuICBzd2l0Y2ggKGZpZWxkTmFtZSkge1xuICAgIGNhc2UgJ29iamVjdElkJzpcbiAgICAgIHJldHVybiAnX2lkJztcbiAgICBjYXNlICdjcmVhdGVkQXQnOlxuICAgICAgcmV0dXJuICdfY3JlYXRlZF9hdCc7XG4gICAgY2FzZSAndXBkYXRlZEF0JzpcbiAgICAgIHJldHVybiAnX3VwZGF0ZWRfYXQnO1xuICAgIGNhc2UgJ3Nlc3Npb25Ub2tlbic6XG4gICAgICByZXR1cm4gJ19zZXNzaW9uX3Rva2VuJztcbiAgICBjYXNlICdsYXN0VXNlZCc6XG4gICAgICByZXR1cm4gJ19sYXN0X3VzZWQnO1xuICAgIGNhc2UgJ3RpbWVzVXNlZCc6XG4gICAgICByZXR1cm4gJ3RpbWVzX3VzZWQnO1xuICB9XG5cbiAgaWYgKFxuICAgIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXSAmJlxuICAgIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS5fX3R5cGUgPT0gJ1BvaW50ZXInXG4gICkge1xuICAgIGZpZWxkTmFtZSA9ICdfcF8nICsgZmllbGROYW1lO1xuICB9IGVsc2UgaWYgKFxuICAgIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXSAmJlxuICAgIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09ICdQb2ludGVyJ1xuICApIHtcbiAgICBmaWVsZE5hbWUgPSAnX3BfJyArIGZpZWxkTmFtZTtcbiAgfVxuXG4gIHJldHVybiBmaWVsZE5hbWU7XG59O1xuXG5jb25zdCB0cmFuc2Zvcm1LZXlWYWx1ZUZvclVwZGF0ZSA9IChcbiAgY2xhc3NOYW1lLFxuICByZXN0S2V5LFxuICByZXN0VmFsdWUsXG4gIHBhcnNlRm9ybWF0U2NoZW1hXG4pID0+IHtcbiAgLy8gQ2hlY2sgaWYgdGhlIHNjaGVtYSBpcyBrbm93biBzaW5jZSBpdCdzIGEgYnVpbHQtaW4gZmllbGQuXG4gIHZhciBrZXkgPSByZXN0S2V5O1xuICB2YXIgdGltZUZpZWxkID0gZmFsc2U7XG4gIHN3aXRjaCAoa2V5KSB7XG4gICAgY2FzZSAnb2JqZWN0SWQnOlxuICAgIGNhc2UgJ19pZCc6XG4gICAgICBpZiAoY2xhc3NOYW1lID09PSAnX0dsb2JhbENvbmZpZycpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBrZXk6IGtleSxcbiAgICAgICAgICB2YWx1ZTogcGFyc2VJbnQocmVzdFZhbHVlKSxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGtleSA9ICdfaWQnO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnY3JlYXRlZEF0JzpcbiAgICBjYXNlICdfY3JlYXRlZF9hdCc6XG4gICAgICBrZXkgPSAnX2NyZWF0ZWRfYXQnO1xuICAgICAgdGltZUZpZWxkID0gdHJ1ZTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ3VwZGF0ZWRBdCc6XG4gICAgY2FzZSAnX3VwZGF0ZWRfYXQnOlxuICAgICAga2V5ID0gJ191cGRhdGVkX2F0JztcbiAgICAgIHRpbWVGaWVsZCA9IHRydWU7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdzZXNzaW9uVG9rZW4nOlxuICAgIGNhc2UgJ19zZXNzaW9uX3Rva2VuJzpcbiAgICAgIGtleSA9ICdfc2Vzc2lvbl90b2tlbic7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdleHBpcmVzQXQnOlxuICAgIGNhc2UgJ19leHBpcmVzQXQnOlxuICAgICAga2V5ID0gJ2V4cGlyZXNBdCc7XG4gICAgICB0aW1lRmllbGQgPSB0cnVlO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0JzpcbiAgICAgIGtleSA9ICdfZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQnO1xuICAgICAgdGltZUZpZWxkID0gdHJ1ZTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ19hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCc6XG4gICAgICBrZXkgPSAnX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0JztcbiAgICAgIHRpbWVGaWVsZCA9IHRydWU7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdfZmFpbGVkX2xvZ2luX2NvdW50JzpcbiAgICAgIGtleSA9ICdfZmFpbGVkX2xvZ2luX2NvdW50JztcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ19wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQnOlxuICAgICAga2V5ID0gJ19wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQnO1xuICAgICAgdGltZUZpZWxkID0gdHJ1ZTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ19wYXNzd29yZF9jaGFuZ2VkX2F0JzpcbiAgICAgIGtleSA9ICdfcGFzc3dvcmRfY2hhbmdlZF9hdCc7XG4gICAgICB0aW1lRmllbGQgPSB0cnVlO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnX3JwZXJtJzpcbiAgICBjYXNlICdfd3Blcm0nOlxuICAgICAgcmV0dXJuIHsga2V5OiBrZXksIHZhbHVlOiByZXN0VmFsdWUgfTtcbiAgICBjYXNlICdsYXN0VXNlZCc6XG4gICAgY2FzZSAnX2xhc3RfdXNlZCc6XG4gICAgICBrZXkgPSAnX2xhc3RfdXNlZCc7XG4gICAgICB0aW1lRmllbGQgPSB0cnVlO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAndGltZXNVc2VkJzpcbiAgICBjYXNlICd0aW1lc191c2VkJzpcbiAgICAgIGtleSA9ICd0aW1lc191c2VkJztcbiAgICAgIHRpbWVGaWVsZCA9IHRydWU7XG4gICAgICBicmVhaztcbiAgfVxuXG4gIGlmIChcbiAgICAocGFyc2VGb3JtYXRTY2hlbWEuZmllbGRzW2tleV0gJiZcbiAgICAgIHBhcnNlRm9ybWF0U2NoZW1hLmZpZWxkc1trZXldLnR5cGUgPT09ICdQb2ludGVyJykgfHxcbiAgICAoIXBhcnNlRm9ybWF0U2NoZW1hLmZpZWxkc1trZXldICYmXG4gICAgICByZXN0VmFsdWUgJiZcbiAgICAgIHJlc3RWYWx1ZS5fX3R5cGUgPT0gJ1BvaW50ZXInKVxuICApIHtcbiAgICBrZXkgPSAnX3BfJyArIGtleTtcbiAgfVxuXG4gIC8vIEhhbmRsZSBhdG9taWMgdmFsdWVzXG4gIHZhciB2YWx1ZSA9IHRyYW5zZm9ybVRvcExldmVsQXRvbShyZXN0VmFsdWUpO1xuICBpZiAodmFsdWUgIT09IENhbm5vdFRyYW5zZm9ybSkge1xuICAgIGlmICh0aW1lRmllbGQgJiYgdHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgICAgdmFsdWUgPSBuZXcgRGF0ZSh2YWx1ZSk7XG4gICAgfVxuICAgIGlmIChyZXN0S2V5LmluZGV4T2YoJy4nKSA+IDApIHtcbiAgICAgIHJldHVybiB7IGtleSwgdmFsdWU6IHJlc3RWYWx1ZSB9O1xuICAgIH1cbiAgICByZXR1cm4geyBrZXksIHZhbHVlIH07XG4gIH1cblxuICAvLyBIYW5kbGUgYXJyYXlzXG4gIGlmIChyZXN0VmFsdWUgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgIHZhbHVlID0gcmVzdFZhbHVlLm1hcCh0cmFuc2Zvcm1JbnRlcmlvclZhbHVlKTtcbiAgICByZXR1cm4geyBrZXksIHZhbHVlIH07XG4gIH1cblxuICAvLyBIYW5kbGUgdXBkYXRlIG9wZXJhdG9yc1xuICBpZiAodHlwZW9mIHJlc3RWYWx1ZSA9PT0gJ29iamVjdCcgJiYgJ19fb3AnIGluIHJlc3RWYWx1ZSkge1xuICAgIHJldHVybiB7IGtleSwgdmFsdWU6IHRyYW5zZm9ybVVwZGF0ZU9wZXJhdG9yKHJlc3RWYWx1ZSwgZmFsc2UpIH07XG4gIH1cblxuICAvLyBIYW5kbGUgbm9ybWFsIG9iamVjdHMgYnkgcmVjdXJzaW5nXG4gIHZhbHVlID0gbWFwVmFsdWVzKHJlc3RWYWx1ZSwgdHJhbnNmb3JtSW50ZXJpb3JWYWx1ZSk7XG4gIHJldHVybiB7IGtleSwgdmFsdWUgfTtcbn07XG5cbmNvbnN0IGlzUmVnZXggPSB2YWx1ZSA9PiB7XG4gIHJldHVybiB2YWx1ZSAmJiB2YWx1ZSBpbnN0YW5jZW9mIFJlZ0V4cDtcbn07XG5cbmNvbnN0IGlzU3RhcnRzV2l0aFJlZ2V4ID0gdmFsdWUgPT4ge1xuICBpZiAoIWlzUmVnZXgodmFsdWUpKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgY29uc3QgbWF0Y2hlcyA9IHZhbHVlLnRvU3RyaW5nKCkubWF0Y2goL1xcL1xcXlxcXFxRLipcXFxcRVxcLy8pO1xuICByZXR1cm4gISFtYXRjaGVzO1xufTtcblxuY29uc3QgaXNBbGxWYWx1ZXNSZWdleE9yTm9uZSA9IHZhbHVlcyA9PiB7XG4gIGlmICghdmFsdWVzIHx8ICFBcnJheS5pc0FycmF5KHZhbHVlcykgfHwgdmFsdWVzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgY29uc3QgZmlyc3RWYWx1ZXNJc1JlZ2V4ID0gaXNTdGFydHNXaXRoUmVnZXgodmFsdWVzWzBdKTtcbiAgaWYgKHZhbHVlcy5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gZmlyc3RWYWx1ZXNJc1JlZ2V4O1xuICB9XG5cbiAgZm9yIChsZXQgaSA9IDEsIGxlbmd0aCA9IHZhbHVlcy5sZW5ndGg7IGkgPCBsZW5ndGg7ICsraSkge1xuICAgIGlmIChmaXJzdFZhbHVlc0lzUmVnZXggIT09IGlzU3RhcnRzV2l0aFJlZ2V4KHZhbHVlc1tpXSkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdHJ1ZTtcbn07XG5cbmNvbnN0IGlzQW55VmFsdWVSZWdleCA9IHZhbHVlcyA9PiB7XG4gIHJldHVybiB2YWx1ZXMuc29tZShmdW5jdGlvbih2YWx1ZSkge1xuICAgIHJldHVybiBpc1JlZ2V4KHZhbHVlKTtcbiAgfSk7XG59O1xuXG5jb25zdCB0cmFuc2Zvcm1JbnRlcmlvclZhbHVlID0gcmVzdFZhbHVlID0+IHtcbiAgaWYgKFxuICAgIHJlc3RWYWx1ZSAhPT0gbnVsbCAmJlxuICAgIHR5cGVvZiByZXN0VmFsdWUgPT09ICdvYmplY3QnICYmXG4gICAgT2JqZWN0LmtleXMocmVzdFZhbHVlKS5zb21lKGtleSA9PiBrZXkuaW5jbHVkZXMoJyQnKSB8fCBrZXkuaW5jbHVkZXMoJy4nKSlcbiAgKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9ORVNURURfS0VZLFxuICAgICAgXCJOZXN0ZWQga2V5cyBzaG91bGQgbm90IGNvbnRhaW4gdGhlICckJyBvciAnLicgY2hhcmFjdGVyc1wiXG4gICAgKTtcbiAgfVxuICAvLyBIYW5kbGUgYXRvbWljIHZhbHVlc1xuICB2YXIgdmFsdWUgPSB0cmFuc2Zvcm1JbnRlcmlvckF0b20ocmVzdFZhbHVlKTtcbiAgaWYgKHZhbHVlICE9PSBDYW5ub3RUcmFuc2Zvcm0pIHtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH1cblxuICAvLyBIYW5kbGUgYXJyYXlzXG4gIGlmIChyZXN0VmFsdWUgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgIHJldHVybiByZXN0VmFsdWUubWFwKHRyYW5zZm9ybUludGVyaW9yVmFsdWUpO1xuICB9XG5cbiAgLy8gSGFuZGxlIHVwZGF0ZSBvcGVyYXRvcnNcbiAgaWYgKHR5cGVvZiByZXN0VmFsdWUgPT09ICdvYmplY3QnICYmICdfX29wJyBpbiByZXN0VmFsdWUpIHtcbiAgICByZXR1cm4gdHJhbnNmb3JtVXBkYXRlT3BlcmF0b3IocmVzdFZhbHVlLCB0cnVlKTtcbiAgfVxuXG4gIC8vIEhhbmRsZSBub3JtYWwgb2JqZWN0cyBieSByZWN1cnNpbmdcbiAgcmV0dXJuIG1hcFZhbHVlcyhyZXN0VmFsdWUsIHRyYW5zZm9ybUludGVyaW9yVmFsdWUpO1xufTtcblxuY29uc3QgdmFsdWVBc0RhdGUgPSB2YWx1ZSA9PiB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIG5ldyBEYXRlKHZhbHVlKTtcbiAgfSBlbHNlIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuZnVuY3Rpb24gdHJhbnNmb3JtUXVlcnlLZXlWYWx1ZShjbGFzc05hbWUsIGtleSwgdmFsdWUsIHNjaGVtYSkge1xuICBzd2l0Y2ggKGtleSkge1xuICAgIGNhc2UgJ2NyZWF0ZWRBdCc6XG4gICAgICBpZiAodmFsdWVBc0RhdGUodmFsdWUpKSB7XG4gICAgICAgIHJldHVybiB7IGtleTogJ19jcmVhdGVkX2F0JywgdmFsdWU6IHZhbHVlQXNEYXRlKHZhbHVlKSB9O1xuICAgICAgfVxuICAgICAga2V5ID0gJ19jcmVhdGVkX2F0JztcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ3VwZGF0ZWRBdCc6XG4gICAgICBpZiAodmFsdWVBc0RhdGUodmFsdWUpKSB7XG4gICAgICAgIHJldHVybiB7IGtleTogJ191cGRhdGVkX2F0JywgdmFsdWU6IHZhbHVlQXNEYXRlKHZhbHVlKSB9O1xuICAgICAgfVxuICAgICAga2V5ID0gJ191cGRhdGVkX2F0JztcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2V4cGlyZXNBdCc6XG4gICAgICBpZiAodmFsdWVBc0RhdGUodmFsdWUpKSB7XG4gICAgICAgIHJldHVybiB7IGtleTogJ2V4cGlyZXNBdCcsIHZhbHVlOiB2YWx1ZUFzRGF0ZSh2YWx1ZSkgfTtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ19lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdCc6XG4gICAgICBpZiAodmFsdWVBc0RhdGUodmFsdWUpKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAga2V5OiAnX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0JyxcbiAgICAgICAgICB2YWx1ZTogdmFsdWVBc0RhdGUodmFsdWUpLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnb2JqZWN0SWQnOiB7XG4gICAgICBpZiAoY2xhc3NOYW1lID09PSAnX0dsb2JhbENvbmZpZycpIHtcbiAgICAgICAgdmFsdWUgPSBwYXJzZUludCh2YWx1ZSk7XG4gICAgICB9XG4gICAgICByZXR1cm4geyBrZXk6ICdfaWQnLCB2YWx1ZSB9O1xuICAgIH1cbiAgICBjYXNlICdfYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQnOlxuICAgICAgaWYgKHZhbHVlQXNEYXRlKHZhbHVlKSkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGtleTogJ19hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCcsXG4gICAgICAgICAgdmFsdWU6IHZhbHVlQXNEYXRlKHZhbHVlKSxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ19mYWlsZWRfbG9naW5fY291bnQnOlxuICAgICAgcmV0dXJuIHsga2V5LCB2YWx1ZSB9O1xuICAgIGNhc2UgJ3Nlc3Npb25Ub2tlbic6XG4gICAgICByZXR1cm4geyBrZXk6ICdfc2Vzc2lvbl90b2tlbicsIHZhbHVlIH07XG4gICAgY2FzZSAnX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCc6XG4gICAgICBpZiAodmFsdWVBc0RhdGUodmFsdWUpKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAga2V5OiAnX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCcsXG4gICAgICAgICAgdmFsdWU6IHZhbHVlQXNEYXRlKHZhbHVlKSxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ19wYXNzd29yZF9jaGFuZ2VkX2F0JzpcbiAgICAgIGlmICh2YWx1ZUFzRGF0ZSh2YWx1ZSkpIHtcbiAgICAgICAgcmV0dXJuIHsga2V5OiAnX3Bhc3N3b3JkX2NoYW5nZWRfYXQnLCB2YWx1ZTogdmFsdWVBc0RhdGUodmFsdWUpIH07XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdfcnBlcm0nOlxuICAgIGNhc2UgJ193cGVybSc6XG4gICAgY2FzZSAnX3BlcmlzaGFibGVfdG9rZW4nOlxuICAgIGNhc2UgJ19lbWFpbF92ZXJpZnlfdG9rZW4nOlxuICAgICAgcmV0dXJuIHsga2V5LCB2YWx1ZSB9O1xuICAgIGNhc2UgJyRvcic6XG4gICAgY2FzZSAnJGFuZCc6XG4gICAgY2FzZSAnJG5vcic6XG4gICAgICByZXR1cm4ge1xuICAgICAgICBrZXk6IGtleSxcbiAgICAgICAgdmFsdWU6IHZhbHVlLm1hcChzdWJRdWVyeSA9PlxuICAgICAgICAgIHRyYW5zZm9ybVdoZXJlKGNsYXNzTmFtZSwgc3ViUXVlcnksIHNjaGVtYSlcbiAgICAgICAgKSxcbiAgICAgIH07XG4gICAgY2FzZSAnbGFzdFVzZWQnOlxuICAgICAgaWYgKHZhbHVlQXNEYXRlKHZhbHVlKSkge1xuICAgICAgICByZXR1cm4geyBrZXk6ICdfbGFzdF91c2VkJywgdmFsdWU6IHZhbHVlQXNEYXRlKHZhbHVlKSB9O1xuICAgICAgfVxuICAgICAga2V5ID0gJ19sYXN0X3VzZWQnO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAndGltZXNVc2VkJzpcbiAgICAgIHJldHVybiB7IGtleTogJ3RpbWVzX3VzZWQnLCB2YWx1ZTogdmFsdWUgfTtcbiAgICBkZWZhdWx0OiB7XG4gICAgICAvLyBPdGhlciBhdXRoIGRhdGFcbiAgICAgIGNvbnN0IGF1dGhEYXRhTWF0Y2ggPSBrZXkubWF0Y2goL15hdXRoRGF0YVxcLihbYS16QS1aMC05X10rKVxcLmlkJC8pO1xuICAgICAgaWYgKGF1dGhEYXRhTWF0Y2gpIHtcbiAgICAgICAgY29uc3QgcHJvdmlkZXIgPSBhdXRoRGF0YU1hdGNoWzFdO1xuICAgICAgICAvLyBTcGVjaWFsLWNhc2UgYXV0aCBkYXRhLlxuICAgICAgICByZXR1cm4geyBrZXk6IGBfYXV0aF9kYXRhXyR7cHJvdmlkZXJ9LmlkYCwgdmFsdWUgfTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBjb25zdCBleHBlY3RlZFR5cGVJc0FycmF5ID1cbiAgICBzY2hlbWEgJiYgc2NoZW1hLmZpZWxkc1trZXldICYmIHNjaGVtYS5maWVsZHNba2V5XS50eXBlID09PSAnQXJyYXknO1xuXG4gIGNvbnN0IGV4cGVjdGVkVHlwZUlzUG9pbnRlciA9XG4gICAgc2NoZW1hICYmIHNjaGVtYS5maWVsZHNba2V5XSAmJiBzY2hlbWEuZmllbGRzW2tleV0udHlwZSA9PT0gJ1BvaW50ZXInO1xuXG4gIGNvbnN0IGZpZWxkID0gc2NoZW1hICYmIHNjaGVtYS5maWVsZHNba2V5XTtcbiAgaWYgKFxuICAgIGV4cGVjdGVkVHlwZUlzUG9pbnRlciB8fFxuICAgICghc2NoZW1hICYmIHZhbHVlICYmIHZhbHVlLl9fdHlwZSA9PT0gJ1BvaW50ZXInKVxuICApIHtcbiAgICBrZXkgPSAnX3BfJyArIGtleTtcbiAgfVxuXG4gIC8vIEhhbmRsZSBxdWVyeSBjb25zdHJhaW50c1xuICBjb25zdCB0cmFuc2Zvcm1lZENvbnN0cmFpbnQgPSB0cmFuc2Zvcm1Db25zdHJhaW50KHZhbHVlLCBmaWVsZCk7XG4gIGlmICh0cmFuc2Zvcm1lZENvbnN0cmFpbnQgIT09IENhbm5vdFRyYW5zZm9ybSkge1xuICAgIGlmICh0cmFuc2Zvcm1lZENvbnN0cmFpbnQuJHRleHQpIHtcbiAgICAgIHJldHVybiB7IGtleTogJyR0ZXh0JywgdmFsdWU6IHRyYW5zZm9ybWVkQ29uc3RyYWludC4kdGV4dCB9O1xuICAgIH1cbiAgICBpZiAodHJhbnNmb3JtZWRDb25zdHJhaW50LiRlbGVtTWF0Y2gpIHtcbiAgICAgIHJldHVybiB7IGtleTogJyRub3InLCB2YWx1ZTogW3sgW2tleV06IHRyYW5zZm9ybWVkQ29uc3RyYWludCB9XSB9O1xuICAgIH1cbiAgICByZXR1cm4geyBrZXksIHZhbHVlOiB0cmFuc2Zvcm1lZENvbnN0cmFpbnQgfTtcbiAgfVxuXG4gIGlmIChleHBlY3RlZFR5cGVJc0FycmF5ICYmICEodmFsdWUgaW5zdGFuY2VvZiBBcnJheSkpIHtcbiAgICByZXR1cm4geyBrZXksIHZhbHVlOiB7ICRhbGw6IFt0cmFuc2Zvcm1JbnRlcmlvckF0b20odmFsdWUpXSB9IH07XG4gIH1cblxuICAvLyBIYW5kbGUgYXRvbWljIHZhbHVlc1xuICBpZiAodHJhbnNmb3JtVG9wTGV2ZWxBdG9tKHZhbHVlKSAhPT0gQ2Fubm90VHJhbnNmb3JtKSB7XG4gICAgcmV0dXJuIHsga2V5LCB2YWx1ZTogdHJhbnNmb3JtVG9wTGV2ZWxBdG9tKHZhbHVlKSB9O1xuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgIGBZb3UgY2Fubm90IHVzZSAke3ZhbHVlfSBhcyBhIHF1ZXJ5IHBhcmFtZXRlci5gXG4gICAgKTtcbiAgfVxufVxuXG4vLyBNYWluIGV4cG9zZWQgbWV0aG9kIHRvIGhlbHAgcnVuIHF1ZXJpZXMuXG4vLyByZXN0V2hlcmUgaXMgdGhlIFwid2hlcmVcIiBjbGF1c2UgaW4gUkVTVCBBUEkgZm9ybS5cbi8vIFJldHVybnMgdGhlIG1vbmdvIGZvcm0gb2YgdGhlIHF1ZXJ5LlxuZnVuY3Rpb24gdHJhbnNmb3JtV2hlcmUoY2xhc3NOYW1lLCByZXN0V2hlcmUsIHNjaGVtYSkge1xuICBjb25zdCBtb25nb1doZXJlID0ge307XG4gIGZvciAoY29uc3QgcmVzdEtleSBpbiByZXN0V2hlcmUpIHtcbiAgICBjb25zdCBvdXQgPSB0cmFuc2Zvcm1RdWVyeUtleVZhbHVlKFxuICAgICAgY2xhc3NOYW1lLFxuICAgICAgcmVzdEtleSxcbiAgICAgIHJlc3RXaGVyZVtyZXN0S2V5XSxcbiAgICAgIHNjaGVtYVxuICAgICk7XG4gICAgbW9uZ29XaGVyZVtvdXQua2V5XSA9IG91dC52YWx1ZTtcbiAgfVxuICByZXR1cm4gbW9uZ29XaGVyZTtcbn1cblxuY29uc3QgcGFyc2VPYmplY3RLZXlWYWx1ZVRvTW9uZ29PYmplY3RLZXlWYWx1ZSA9IChcbiAgcmVzdEtleSxcbiAgcmVzdFZhbHVlLFxuICBzY2hlbWFcbikgPT4ge1xuICAvLyBDaGVjayBpZiB0aGUgc2NoZW1hIGlzIGtub3duIHNpbmNlIGl0J3MgYSBidWlsdC1pbiBmaWVsZC5cbiAgbGV0IHRyYW5zZm9ybWVkVmFsdWU7XG4gIGxldCBjb2VyY2VkVG9EYXRlO1xuICBzd2l0Y2ggKHJlc3RLZXkpIHtcbiAgICBjYXNlICdvYmplY3RJZCc6XG4gICAgICByZXR1cm4geyBrZXk6ICdfaWQnLCB2YWx1ZTogcmVzdFZhbHVlIH07XG4gICAgY2FzZSAnZXhwaXJlc0F0JzpcbiAgICAgIHRyYW5zZm9ybWVkVmFsdWUgPSB0cmFuc2Zvcm1Ub3BMZXZlbEF0b20ocmVzdFZhbHVlKTtcbiAgICAgIGNvZXJjZWRUb0RhdGUgPVxuICAgICAgICB0eXBlb2YgdHJhbnNmb3JtZWRWYWx1ZSA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IG5ldyBEYXRlKHRyYW5zZm9ybWVkVmFsdWUpXG4gICAgICAgICAgOiB0cmFuc2Zvcm1lZFZhbHVlO1xuICAgICAgcmV0dXJuIHsga2V5OiAnZXhwaXJlc0F0JywgdmFsdWU6IGNvZXJjZWRUb0RhdGUgfTtcbiAgICBjYXNlICdfZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQnOlxuICAgICAgdHJhbnNmb3JtZWRWYWx1ZSA9IHRyYW5zZm9ybVRvcExldmVsQXRvbShyZXN0VmFsdWUpO1xuICAgICAgY29lcmNlZFRvRGF0ZSA9XG4gICAgICAgIHR5cGVvZiB0cmFuc2Zvcm1lZFZhbHVlID09PSAnc3RyaW5nJ1xuICAgICAgICAgID8gbmV3IERhdGUodHJhbnNmb3JtZWRWYWx1ZSlcbiAgICAgICAgICA6IHRyYW5zZm9ybWVkVmFsdWU7XG4gICAgICByZXR1cm4geyBrZXk6ICdfZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQnLCB2YWx1ZTogY29lcmNlZFRvRGF0ZSB9O1xuICAgIGNhc2UgJ19hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCc6XG4gICAgICB0cmFuc2Zvcm1lZFZhbHVlID0gdHJhbnNmb3JtVG9wTGV2ZWxBdG9tKHJlc3RWYWx1ZSk7XG4gICAgICBjb2VyY2VkVG9EYXRlID1cbiAgICAgICAgdHlwZW9mIHRyYW5zZm9ybWVkVmFsdWUgPT09ICdzdHJpbmcnXG4gICAgICAgICAgPyBuZXcgRGF0ZSh0cmFuc2Zvcm1lZFZhbHVlKVxuICAgICAgICAgIDogdHJhbnNmb3JtZWRWYWx1ZTtcbiAgICAgIHJldHVybiB7IGtleTogJ19hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCcsIHZhbHVlOiBjb2VyY2VkVG9EYXRlIH07XG4gICAgY2FzZSAnX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCc6XG4gICAgICB0cmFuc2Zvcm1lZFZhbHVlID0gdHJhbnNmb3JtVG9wTGV2ZWxBdG9tKHJlc3RWYWx1ZSk7XG4gICAgICBjb2VyY2VkVG9EYXRlID1cbiAgICAgICAgdHlwZW9mIHRyYW5zZm9ybWVkVmFsdWUgPT09ICdzdHJpbmcnXG4gICAgICAgICAgPyBuZXcgRGF0ZSh0cmFuc2Zvcm1lZFZhbHVlKVxuICAgICAgICAgIDogdHJhbnNmb3JtZWRWYWx1ZTtcbiAgICAgIHJldHVybiB7IGtleTogJ19wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQnLCB2YWx1ZTogY29lcmNlZFRvRGF0ZSB9O1xuICAgIGNhc2UgJ19wYXNzd29yZF9jaGFuZ2VkX2F0JzpcbiAgICAgIHRyYW5zZm9ybWVkVmFsdWUgPSB0cmFuc2Zvcm1Ub3BMZXZlbEF0b20ocmVzdFZhbHVlKTtcbiAgICAgIGNvZXJjZWRUb0RhdGUgPVxuICAgICAgICB0eXBlb2YgdHJhbnNmb3JtZWRWYWx1ZSA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IG5ldyBEYXRlKHRyYW5zZm9ybWVkVmFsdWUpXG4gICAgICAgICAgOiB0cmFuc2Zvcm1lZFZhbHVlO1xuICAgICAgcmV0dXJuIHsga2V5OiAnX3Bhc3N3b3JkX2NoYW5nZWRfYXQnLCB2YWx1ZTogY29lcmNlZFRvRGF0ZSB9O1xuICAgIGNhc2UgJ19mYWlsZWRfbG9naW5fY291bnQnOlxuICAgIGNhc2UgJ19ycGVybSc6XG4gICAgY2FzZSAnX3dwZXJtJzpcbiAgICBjYXNlICdfZW1haWxfdmVyaWZ5X3Rva2VuJzpcbiAgICBjYXNlICdfaGFzaGVkX3Bhc3N3b3JkJzpcbiAgICBjYXNlICdfcGVyaXNoYWJsZV90b2tlbic6XG4gICAgICByZXR1cm4geyBrZXk6IHJlc3RLZXksIHZhbHVlOiByZXN0VmFsdWUgfTtcbiAgICBjYXNlICdzZXNzaW9uVG9rZW4nOlxuICAgICAgcmV0dXJuIHsga2V5OiAnX3Nlc3Npb25fdG9rZW4nLCB2YWx1ZTogcmVzdFZhbHVlIH07XG4gICAgZGVmYXVsdDpcbiAgICAgIC8vIEF1dGggZGF0YSBzaG91bGQgaGF2ZSBiZWVuIHRyYW5zZm9ybWVkIGFscmVhZHlcbiAgICAgIGlmIChyZXN0S2V5Lm1hdGNoKC9eYXV0aERhdGFcXC4oW2EtekEtWjAtOV9dKylcXC5pZCQvKSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSxcbiAgICAgICAgICAnY2FuIG9ubHkgcXVlcnkgb24gJyArIHJlc3RLZXlcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIC8vIFRydXN0IHRoYXQgdGhlIGF1dGggZGF0YSBoYXMgYmVlbiB0cmFuc2Zvcm1lZCBhbmQgc2F2ZSBpdCBkaXJlY3RseVxuICAgICAgaWYgKHJlc3RLZXkubWF0Y2goL15fYXV0aF9kYXRhX1thLXpBLVowLTlfXSskLykpIHtcbiAgICAgICAgcmV0dXJuIHsga2V5OiByZXN0S2V5LCB2YWx1ZTogcmVzdFZhbHVlIH07XG4gICAgICB9XG4gIH1cbiAgLy9za2lwIHN0cmFpZ2h0IHRvIHRyYW5zZm9ybVRvcExldmVsQXRvbSBmb3IgQnl0ZXMsIHRoZXkgZG9uJ3Qgc2hvdyB1cCBpbiB0aGUgc2NoZW1hIGZvciBzb21lIHJlYXNvblxuICBpZiAocmVzdFZhbHVlICYmIHJlc3RWYWx1ZS5fX3R5cGUgIT09ICdCeXRlcycpIHtcbiAgICAvL05vdGU6IFdlIG1heSBub3Qga25vdyB0aGUgdHlwZSBvZiBhIGZpZWxkIGhlcmUsIGFzIHRoZSB1c2VyIGNvdWxkIGJlIHNhdmluZyAobnVsbCkgdG8gYSBmaWVsZFxuICAgIC8vVGhhdCBuZXZlciBleGlzdGVkIGJlZm9yZSwgbWVhbmluZyB3ZSBjYW4ndCBpbmZlciB0aGUgdHlwZS5cbiAgICBpZiAoXG4gICAgICAoc2NoZW1hLmZpZWxkc1tyZXN0S2V5XSAmJiBzY2hlbWEuZmllbGRzW3Jlc3RLZXldLnR5cGUgPT0gJ1BvaW50ZXInKSB8fFxuICAgICAgcmVzdFZhbHVlLl9fdHlwZSA9PSAnUG9pbnRlcidcbiAgICApIHtcbiAgICAgIHJlc3RLZXkgPSAnX3BfJyArIHJlc3RLZXk7XG4gICAgfVxuICB9XG5cbiAgLy8gSGFuZGxlIGF0b21pYyB2YWx1ZXNcbiAgdmFyIHZhbHVlID0gdHJhbnNmb3JtVG9wTGV2ZWxBdG9tKHJlc3RWYWx1ZSk7XG4gIGlmICh2YWx1ZSAhPT0gQ2Fubm90VHJhbnNmb3JtKSB7XG4gICAgcmV0dXJuIHsga2V5OiByZXN0S2V5LCB2YWx1ZTogdmFsdWUgfTtcbiAgfVxuXG4gIC8vIEFDTHMgYXJlIGhhbmRsZWQgYmVmb3JlIHRoaXMgbWV0aG9kIGlzIGNhbGxlZFxuICAvLyBJZiBhbiBBQ0wga2V5IHN0aWxsIGV4aXN0cyBoZXJlLCBzb21ldGhpbmcgaXMgd3JvbmcuXG4gIGlmIChyZXN0S2V5ID09PSAnQUNMJykge1xuICAgIHRocm93ICdUaGVyZSB3YXMgYSBwcm9ibGVtIHRyYW5zZm9ybWluZyBhbiBBQ0wuJztcbiAgfVxuXG4gIC8vIEhhbmRsZSBhcnJheXNcbiAgaWYgKHJlc3RWYWx1ZSBpbnN0YW5jZW9mIEFycmF5KSB7XG4gICAgdmFsdWUgPSByZXN0VmFsdWUubWFwKHRyYW5zZm9ybUludGVyaW9yVmFsdWUpO1xuICAgIHJldHVybiB7IGtleTogcmVzdEtleSwgdmFsdWU6IHZhbHVlIH07XG4gIH1cblxuICAvLyBIYW5kbGUgbm9ybWFsIG9iamVjdHMgYnkgcmVjdXJzaW5nXG4gIGlmIChcbiAgICBPYmplY3Qua2V5cyhyZXN0VmFsdWUpLnNvbWUoa2V5ID0+IGtleS5pbmNsdWRlcygnJCcpIHx8IGtleS5pbmNsdWRlcygnLicpKVxuICApIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICBQYXJzZS5FcnJvci5JTlZBTElEX05FU1RFRF9LRVksXG4gICAgICBcIk5lc3RlZCBrZXlzIHNob3VsZCBub3QgY29udGFpbiB0aGUgJyQnIG9yICcuJyBjaGFyYWN0ZXJzXCJcbiAgICApO1xuICB9XG4gIHZhbHVlID0gbWFwVmFsdWVzKHJlc3RWYWx1ZSwgdHJhbnNmb3JtSW50ZXJpb3JWYWx1ZSk7XG4gIHJldHVybiB7IGtleTogcmVzdEtleSwgdmFsdWUgfTtcbn07XG5cbmNvbnN0IHBhcnNlT2JqZWN0VG9Nb25nb09iamVjdEZvckNyZWF0ZSA9IChjbGFzc05hbWUsIHJlc3RDcmVhdGUsIHNjaGVtYSkgPT4ge1xuICByZXN0Q3JlYXRlID0gYWRkTGVnYWN5QUNMKHJlc3RDcmVhdGUpO1xuICBjb25zdCBtb25nb0NyZWF0ZSA9IHt9O1xuICBmb3IgKGNvbnN0IHJlc3RLZXkgaW4gcmVzdENyZWF0ZSkge1xuICAgIGlmIChyZXN0Q3JlYXRlW3Jlc3RLZXldICYmIHJlc3RDcmVhdGVbcmVzdEtleV0uX190eXBlID09PSAnUmVsYXRpb24nKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgeyBrZXksIHZhbHVlIH0gPSBwYXJzZU9iamVjdEtleVZhbHVlVG9Nb25nb09iamVjdEtleVZhbHVlKFxuICAgICAgcmVzdEtleSxcbiAgICAgIHJlc3RDcmVhdGVbcmVzdEtleV0sXG4gICAgICBzY2hlbWFcbiAgICApO1xuICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBtb25nb0NyZWF0ZVtrZXldID0gdmFsdWU7XG4gICAgfVxuICB9XG5cbiAgLy8gVXNlIHRoZSBsZWdhY3kgbW9uZ28gZm9ybWF0IGZvciBjcmVhdGVkQXQgYW5kIHVwZGF0ZWRBdFxuICBpZiAobW9uZ29DcmVhdGUuY3JlYXRlZEF0KSB7XG4gICAgbW9uZ29DcmVhdGUuX2NyZWF0ZWRfYXQgPSBuZXcgRGF0ZShcbiAgICAgIG1vbmdvQ3JlYXRlLmNyZWF0ZWRBdC5pc28gfHwgbW9uZ29DcmVhdGUuY3JlYXRlZEF0XG4gICAgKTtcbiAgICBkZWxldGUgbW9uZ29DcmVhdGUuY3JlYXRlZEF0O1xuICB9XG4gIGlmIChtb25nb0NyZWF0ZS51cGRhdGVkQXQpIHtcbiAgICBtb25nb0NyZWF0ZS5fdXBkYXRlZF9hdCA9IG5ldyBEYXRlKFxuICAgICAgbW9uZ29DcmVhdGUudXBkYXRlZEF0LmlzbyB8fCBtb25nb0NyZWF0ZS51cGRhdGVkQXRcbiAgICApO1xuICAgIGRlbGV0ZSBtb25nb0NyZWF0ZS51cGRhdGVkQXQ7XG4gIH1cblxuICByZXR1cm4gbW9uZ29DcmVhdGU7XG59O1xuXG4vLyBNYWluIGV4cG9zZWQgbWV0aG9kIHRvIGhlbHAgdXBkYXRlIG9sZCBvYmplY3RzLlxuY29uc3QgdHJhbnNmb3JtVXBkYXRlID0gKGNsYXNzTmFtZSwgcmVzdFVwZGF0ZSwgcGFyc2VGb3JtYXRTY2hlbWEpID0+IHtcbiAgY29uc3QgbW9uZ29VcGRhdGUgPSB7fTtcbiAgY29uc3QgYWNsID0gYWRkTGVnYWN5QUNMKHJlc3RVcGRhdGUpO1xuICBpZiAoYWNsLl9ycGVybSB8fCBhY2wuX3dwZXJtIHx8IGFjbC5fYWNsKSB7XG4gICAgbW9uZ29VcGRhdGUuJHNldCA9IHt9O1xuICAgIGlmIChhY2wuX3JwZXJtKSB7XG4gICAgICBtb25nb1VwZGF0ZS4kc2V0Ll9ycGVybSA9IGFjbC5fcnBlcm07XG4gICAgfVxuICAgIGlmIChhY2wuX3dwZXJtKSB7XG4gICAgICBtb25nb1VwZGF0ZS4kc2V0Ll93cGVybSA9IGFjbC5fd3Blcm07XG4gICAgfVxuICAgIGlmIChhY2wuX2FjbCkge1xuICAgICAgbW9uZ29VcGRhdGUuJHNldC5fYWNsID0gYWNsLl9hY2w7XG4gICAgfVxuICB9XG4gIGZvciAodmFyIHJlc3RLZXkgaW4gcmVzdFVwZGF0ZSkge1xuICAgIGlmIChyZXN0VXBkYXRlW3Jlc3RLZXldICYmIHJlc3RVcGRhdGVbcmVzdEtleV0uX190eXBlID09PSAnUmVsYXRpb24nKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgdmFyIG91dCA9IHRyYW5zZm9ybUtleVZhbHVlRm9yVXBkYXRlKFxuICAgICAgY2xhc3NOYW1lLFxuICAgICAgcmVzdEtleSxcbiAgICAgIHJlc3RVcGRhdGVbcmVzdEtleV0sXG4gICAgICBwYXJzZUZvcm1hdFNjaGVtYVxuICAgICk7XG5cbiAgICAvLyBJZiB0aGUgb3V0cHV0IHZhbHVlIGlzIGFuIG9iamVjdCB3aXRoIGFueSAkIGtleXMsIGl0J3MgYW5cbiAgICAvLyBvcGVyYXRvciB0aGF0IG5lZWRzIHRvIGJlIGxpZnRlZCBvbnRvIHRoZSB0b3AgbGV2ZWwgdXBkYXRlXG4gICAgLy8gb2JqZWN0LlxuICAgIGlmICh0eXBlb2Ygb3V0LnZhbHVlID09PSAnb2JqZWN0JyAmJiBvdXQudmFsdWUgIT09IG51bGwgJiYgb3V0LnZhbHVlLl9fb3ApIHtcbiAgICAgIG1vbmdvVXBkYXRlW291dC52YWx1ZS5fX29wXSA9IG1vbmdvVXBkYXRlW291dC52YWx1ZS5fX29wXSB8fCB7fTtcbiAgICAgIG1vbmdvVXBkYXRlW291dC52YWx1ZS5fX29wXVtvdXQua2V5XSA9IG91dC52YWx1ZS5hcmc7XG4gICAgfSBlbHNlIHtcbiAgICAgIG1vbmdvVXBkYXRlWyckc2V0J10gPSBtb25nb1VwZGF0ZVsnJHNldCddIHx8IHt9O1xuICAgICAgbW9uZ29VcGRhdGVbJyRzZXQnXVtvdXQua2V5XSA9IG91dC52YWx1ZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gbW9uZ29VcGRhdGU7XG59O1xuXG4vLyBBZGQgdGhlIGxlZ2FjeSBfYWNsIGZvcm1hdC5cbmNvbnN0IGFkZExlZ2FjeUFDTCA9IHJlc3RPYmplY3QgPT4ge1xuICBjb25zdCByZXN0T2JqZWN0Q29weSA9IHsgLi4ucmVzdE9iamVjdCB9O1xuICBjb25zdCBfYWNsID0ge307XG5cbiAgaWYgKHJlc3RPYmplY3QuX3dwZXJtKSB7XG4gICAgcmVzdE9iamVjdC5fd3Blcm0uZm9yRWFjaChlbnRyeSA9PiB7XG4gICAgICBfYWNsW2VudHJ5XSA9IHsgdzogdHJ1ZSB9O1xuICAgIH0pO1xuICAgIHJlc3RPYmplY3RDb3B5Ll9hY2wgPSBfYWNsO1xuICB9XG5cbiAgaWYgKHJlc3RPYmplY3QuX3JwZXJtKSB7XG4gICAgcmVzdE9iamVjdC5fcnBlcm0uZm9yRWFjaChlbnRyeSA9PiB7XG4gICAgICBpZiAoIShlbnRyeSBpbiBfYWNsKSkge1xuICAgICAgICBfYWNsW2VudHJ5XSA9IHsgcjogdHJ1ZSB9O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgX2FjbFtlbnRyeV0uciA9IHRydWU7XG4gICAgICB9XG4gICAgfSk7XG4gICAgcmVzdE9iamVjdENvcHkuX2FjbCA9IF9hY2w7XG4gIH1cblxuICByZXR1cm4gcmVzdE9iamVjdENvcHk7XG59O1xuXG4vLyBBIHNlbnRpbmVsIHZhbHVlIHRoYXQgaGVscGVyIHRyYW5zZm9ybWF0aW9ucyByZXR1cm4gd2hlbiB0aGV5XG4vLyBjYW5ub3QgcGVyZm9ybSBhIHRyYW5zZm9ybWF0aW9uXG5mdW5jdGlvbiBDYW5ub3RUcmFuc2Zvcm0oKSB7fVxuXG5jb25zdCB0cmFuc2Zvcm1JbnRlcmlvckF0b20gPSBhdG9tID0+IHtcbiAgLy8gVE9ETzogY2hlY2sgdmFsaWRpdHkgaGFyZGVyIGZvciB0aGUgX190eXBlLWRlZmluZWQgdHlwZXNcbiAgaWYgKFxuICAgIHR5cGVvZiBhdG9tID09PSAnb2JqZWN0JyAmJlxuICAgIGF0b20gJiZcbiAgICAhKGF0b20gaW5zdGFuY2VvZiBEYXRlKSAmJlxuICAgIGF0b20uX190eXBlID09PSAnUG9pbnRlcidcbiAgKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIF9fdHlwZTogJ1BvaW50ZXInLFxuICAgICAgY2xhc3NOYW1lOiBhdG9tLmNsYXNzTmFtZSxcbiAgICAgIG9iamVjdElkOiBhdG9tLm9iamVjdElkLFxuICAgIH07XG4gIH0gZWxzZSBpZiAodHlwZW9mIGF0b20gPT09ICdmdW5jdGlvbicgfHwgdHlwZW9mIGF0b20gPT09ICdzeW1ib2wnKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgYGNhbm5vdCB0cmFuc2Zvcm0gdmFsdWU6ICR7YXRvbX1gXG4gICAgKTtcbiAgfSBlbHNlIGlmIChEYXRlQ29kZXIuaXNWYWxpZEpTT04oYXRvbSkpIHtcbiAgICByZXR1cm4gRGF0ZUNvZGVyLkpTT05Ub0RhdGFiYXNlKGF0b20pO1xuICB9IGVsc2UgaWYgKEJ5dGVzQ29kZXIuaXNWYWxpZEpTT04oYXRvbSkpIHtcbiAgICByZXR1cm4gQnl0ZXNDb2Rlci5KU09OVG9EYXRhYmFzZShhdG9tKTtcbiAgfSBlbHNlIGlmICh0eXBlb2YgYXRvbSA9PT0gJ29iamVjdCcgJiYgYXRvbSAmJiBhdG9tLiRyZWdleCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIG5ldyBSZWdFeHAoYXRvbS4kcmVnZXgpO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBhdG9tO1xuICB9XG59O1xuXG4vLyBIZWxwZXIgZnVuY3Rpb24gdG8gdHJhbnNmb3JtIGFuIGF0b20gZnJvbSBSRVNUIGZvcm1hdCB0byBNb25nbyBmb3JtYXQuXG4vLyBBbiBhdG9tIGlzIGFueXRoaW5nIHRoYXQgY2FuJ3QgY29udGFpbiBvdGhlciBleHByZXNzaW9ucy4gU28gaXRcbi8vIGluY2x1ZGVzIHRoaW5ncyB3aGVyZSBvYmplY3RzIGFyZSB1c2VkIHRvIHJlcHJlc2VudCBvdGhlclxuLy8gZGF0YXR5cGVzLCBsaWtlIHBvaW50ZXJzIGFuZCBkYXRlcywgYnV0IGl0IGRvZXMgbm90IGluY2x1ZGUgb2JqZWN0c1xuLy8gb3IgYXJyYXlzIHdpdGggZ2VuZXJpYyBzdHVmZiBpbnNpZGUuXG4vLyBSYWlzZXMgYW4gZXJyb3IgaWYgdGhpcyBjYW5ub3QgcG9zc2libHkgYmUgdmFsaWQgUkVTVCBmb3JtYXQuXG4vLyBSZXR1cm5zIENhbm5vdFRyYW5zZm9ybSBpZiBpdCdzIGp1c3Qgbm90IGFuIGF0b21cbmZ1bmN0aW9uIHRyYW5zZm9ybVRvcExldmVsQXRvbShhdG9tLCBmaWVsZCkge1xuICBzd2l0Y2ggKHR5cGVvZiBhdG9tKSB7XG4gICAgY2FzZSAnbnVtYmVyJzpcbiAgICBjYXNlICdib29sZWFuJzpcbiAgICBjYXNlICd1bmRlZmluZWQnOlxuICAgICAgcmV0dXJuIGF0b207XG4gICAgY2FzZSAnc3RyaW5nJzpcbiAgICAgIGlmIChmaWVsZCAmJiBmaWVsZC50eXBlID09PSAnUG9pbnRlcicpIHtcbiAgICAgICAgcmV0dXJuIGAke2ZpZWxkLnRhcmdldENsYXNzfSQke2F0b219YDtcbiAgICAgIH1cbiAgICAgIHJldHVybiBhdG9tO1xuICAgIGNhc2UgJ3N5bWJvbCc6XG4gICAgY2FzZSAnZnVuY3Rpb24nOlxuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgIGBjYW5ub3QgdHJhbnNmb3JtIHZhbHVlOiAke2F0b219YFxuICAgICAgKTtcbiAgICBjYXNlICdvYmplY3QnOlxuICAgICAgaWYgKGF0b20gaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICAgIC8vIFRlY2huaWNhbGx5IGRhdGVzIGFyZSBub3QgcmVzdCBmb3JtYXQsIGJ1dCwgaXQgc2VlbXMgcHJldHR5XG4gICAgICAgIC8vIGNsZWFyIHdoYXQgdGhleSBzaG91bGQgYmUgdHJhbnNmb3JtZWQgdG8sIHNvIGxldCdzIGp1c3QgZG8gaXQuXG4gICAgICAgIHJldHVybiBhdG9tO1xuICAgICAgfVxuXG4gICAgICBpZiAoYXRvbSA9PT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gYXRvbTtcbiAgICAgIH1cblxuICAgICAgLy8gVE9ETzogY2hlY2sgdmFsaWRpdHkgaGFyZGVyIGZvciB0aGUgX190eXBlLWRlZmluZWQgdHlwZXNcbiAgICAgIGlmIChhdG9tLl9fdHlwZSA9PSAnUG9pbnRlcicpIHtcbiAgICAgICAgcmV0dXJuIGAke2F0b20uY2xhc3NOYW1lfSQke2F0b20ub2JqZWN0SWR9YDtcbiAgICAgIH1cbiAgICAgIGlmIChEYXRlQ29kZXIuaXNWYWxpZEpTT04oYXRvbSkpIHtcbiAgICAgICAgcmV0dXJuIERhdGVDb2Rlci5KU09OVG9EYXRhYmFzZShhdG9tKTtcbiAgICAgIH1cbiAgICAgIGlmIChCeXRlc0NvZGVyLmlzVmFsaWRKU09OKGF0b20pKSB7XG4gICAgICAgIHJldHVybiBCeXRlc0NvZGVyLkpTT05Ub0RhdGFiYXNlKGF0b20pO1xuICAgICAgfVxuICAgICAgaWYgKEdlb1BvaW50Q29kZXIuaXNWYWxpZEpTT04oYXRvbSkpIHtcbiAgICAgICAgcmV0dXJuIEdlb1BvaW50Q29kZXIuSlNPTlRvRGF0YWJhc2UoYXRvbSk7XG4gICAgICB9XG4gICAgICBpZiAoUG9seWdvbkNvZGVyLmlzVmFsaWRKU09OKGF0b20pKSB7XG4gICAgICAgIHJldHVybiBQb2x5Z29uQ29kZXIuSlNPTlRvRGF0YWJhc2UoYXRvbSk7XG4gICAgICB9XG4gICAgICBpZiAoRmlsZUNvZGVyLmlzVmFsaWRKU09OKGF0b20pKSB7XG4gICAgICAgIHJldHVybiBGaWxlQ29kZXIuSlNPTlRvRGF0YWJhc2UoYXRvbSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gQ2Fubm90VHJhbnNmb3JtO1xuXG4gICAgZGVmYXVsdDpcbiAgICAgIC8vIEkgZG9uJ3QgdGhpbmsgdHlwZW9mIGNhbiBldmVyIGxldCB1cyBnZXQgaGVyZVxuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTlRFUk5BTF9TRVJWRVJfRVJST1IsXG4gICAgICAgIGByZWFsbHkgZGlkIG5vdCBleHBlY3QgdmFsdWU6ICR7YXRvbX1gXG4gICAgICApO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlbGF0aXZlVGltZVRvRGF0ZSh0ZXh0LCBub3cgPSBuZXcgRGF0ZSgpKSB7XG4gIHRleHQgPSB0ZXh0LnRvTG93ZXJDYXNlKCk7XG5cbiAgbGV0IHBhcnRzID0gdGV4dC5zcGxpdCgnICcpO1xuXG4gIC8vIEZpbHRlciBvdXQgd2hpdGVzcGFjZVxuICBwYXJ0cyA9IHBhcnRzLmZpbHRlcihwYXJ0ID0+IHBhcnQgIT09ICcnKTtcblxuICBjb25zdCBmdXR1cmUgPSBwYXJ0c1swXSA9PT0gJ2luJztcbiAgY29uc3QgcGFzdCA9IHBhcnRzW3BhcnRzLmxlbmd0aCAtIDFdID09PSAnYWdvJztcblxuICBpZiAoIWZ1dHVyZSAmJiAhcGFzdCAmJiB0ZXh0ICE9PSAnbm93Jykge1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXM6ICdlcnJvcicsXG4gICAgICBpbmZvOiBcIlRpbWUgc2hvdWxkIGVpdGhlciBzdGFydCB3aXRoICdpbicgb3IgZW5kIHdpdGggJ2FnbydcIixcbiAgICB9O1xuICB9XG5cbiAgaWYgKGZ1dHVyZSAmJiBwYXN0KSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1czogJ2Vycm9yJyxcbiAgICAgIGluZm86IFwiVGltZSBjYW5ub3QgaGF2ZSBib3RoICdpbicgYW5kICdhZ28nXCIsXG4gICAgfTtcbiAgfVxuXG4gIC8vIHN0cmlwIHRoZSAnYWdvJyBvciAnaW4nXG4gIGlmIChmdXR1cmUpIHtcbiAgICBwYXJ0cyA9IHBhcnRzLnNsaWNlKDEpO1xuICB9IGVsc2Uge1xuICAgIC8vIHBhc3RcbiAgICBwYXJ0cyA9IHBhcnRzLnNsaWNlKDAsIHBhcnRzLmxlbmd0aCAtIDEpO1xuICB9XG5cbiAgaWYgKHBhcnRzLmxlbmd0aCAlIDIgIT09IDAgJiYgdGV4dCAhPT0gJ25vdycpIHtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzOiAnZXJyb3InLFxuICAgICAgaW5mbzogJ0ludmFsaWQgdGltZSBzdHJpbmcuIERhbmdsaW5nIHVuaXQgb3IgbnVtYmVyLicsXG4gICAgfTtcbiAgfVxuXG4gIGNvbnN0IHBhaXJzID0gW107XG4gIHdoaWxlIChwYXJ0cy5sZW5ndGgpIHtcbiAgICBwYWlycy5wdXNoKFtwYXJ0cy5zaGlmdCgpLCBwYXJ0cy5zaGlmdCgpXSk7XG4gIH1cblxuICBsZXQgc2Vjb25kcyA9IDA7XG4gIGZvciAoY29uc3QgW251bSwgaW50ZXJ2YWxdIG9mIHBhaXJzKSB7XG4gICAgY29uc3QgdmFsID0gTnVtYmVyKG51bSk7XG4gICAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKHZhbCkpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1czogJ2Vycm9yJyxcbiAgICAgICAgaW5mbzogYCcke251bX0nIGlzIG5vdCBhbiBpbnRlZ2VyLmAsXG4gICAgICB9O1xuICAgIH1cblxuICAgIHN3aXRjaCAoaW50ZXJ2YWwpIHtcbiAgICAgIGNhc2UgJ3lyJzpcbiAgICAgIGNhc2UgJ3lycyc6XG4gICAgICBjYXNlICd5ZWFyJzpcbiAgICAgIGNhc2UgJ3llYXJzJzpcbiAgICAgICAgc2Vjb25kcyArPSB2YWwgKiAzMTUzNjAwMDsgLy8gMzY1ICogMjQgKiA2MCAqIDYwXG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBjYXNlICd3ayc6XG4gICAgICBjYXNlICd3a3MnOlxuICAgICAgY2FzZSAnd2Vlayc6XG4gICAgICBjYXNlICd3ZWVrcyc6XG4gICAgICAgIHNlY29uZHMgKz0gdmFsICogNjA0ODAwOyAvLyA3ICogMjQgKiA2MCAqIDYwXG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBjYXNlICdkJzpcbiAgICAgIGNhc2UgJ2RheSc6XG4gICAgICBjYXNlICdkYXlzJzpcbiAgICAgICAgc2Vjb25kcyArPSB2YWwgKiA4NjQwMDsgLy8gMjQgKiA2MCAqIDYwXG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBjYXNlICdocic6XG4gICAgICBjYXNlICdocnMnOlxuICAgICAgY2FzZSAnaG91cic6XG4gICAgICBjYXNlICdob3Vycyc6XG4gICAgICAgIHNlY29uZHMgKz0gdmFsICogMzYwMDsgLy8gNjAgKiA2MFxuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSAnbWluJzpcbiAgICAgIGNhc2UgJ21pbnMnOlxuICAgICAgY2FzZSAnbWludXRlJzpcbiAgICAgIGNhc2UgJ21pbnV0ZXMnOlxuICAgICAgICBzZWNvbmRzICs9IHZhbCAqIDYwO1xuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSAnc2VjJzpcbiAgICAgIGNhc2UgJ3NlY3MnOlxuICAgICAgY2FzZSAnc2Vjb25kJzpcbiAgICAgIGNhc2UgJ3NlY29uZHMnOlxuICAgICAgICBzZWNvbmRzICs9IHZhbDtcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgc3RhdHVzOiAnZXJyb3InLFxuICAgICAgICAgIGluZm86IGBJbnZhbGlkIGludGVydmFsOiAnJHtpbnRlcnZhbH0nYCxcbiAgICAgICAgfTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBtaWxsaXNlY29uZHMgPSBzZWNvbmRzICogMTAwMDtcbiAgaWYgKGZ1dHVyZSkge1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXM6ICdzdWNjZXNzJyxcbiAgICAgIGluZm86ICdmdXR1cmUnLFxuICAgICAgcmVzdWx0OiBuZXcgRGF0ZShub3cudmFsdWVPZigpICsgbWlsbGlzZWNvbmRzKSxcbiAgICB9O1xuICB9IGVsc2UgaWYgKHBhc3QpIHtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzOiAnc3VjY2VzcycsXG4gICAgICBpbmZvOiAncGFzdCcsXG4gICAgICByZXN1bHQ6IG5ldyBEYXRlKG5vdy52YWx1ZU9mKCkgLSBtaWxsaXNlY29uZHMpLFxuICAgIH07XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1czogJ3N1Y2Nlc3MnLFxuICAgICAgaW5mbzogJ3ByZXNlbnQnLFxuICAgICAgcmVzdWx0OiBuZXcgRGF0ZShub3cudmFsdWVPZigpKSxcbiAgICB9O1xuICB9XG59XG5cbi8vIFRyYW5zZm9ybXMgYSBxdWVyeSBjb25zdHJhaW50IGZyb20gUkVTVCBBUEkgZm9ybWF0IHRvIE1vbmdvIGZvcm1hdC5cbi8vIEEgY29uc3RyYWludCBpcyBzb21ldGhpbmcgd2l0aCBmaWVsZHMgbGlrZSAkbHQuXG4vLyBJZiBpdCBpcyBub3QgYSB2YWxpZCBjb25zdHJhaW50IGJ1dCBpdCBjb3VsZCBiZSBhIHZhbGlkIHNvbWV0aGluZ1xuLy8gZWxzZSwgcmV0dXJuIENhbm5vdFRyYW5zZm9ybS5cbi8vIGluQXJyYXkgaXMgd2hldGhlciB0aGlzIGlzIGFuIGFycmF5IGZpZWxkLlxuZnVuY3Rpb24gdHJhbnNmb3JtQ29uc3RyYWludChjb25zdHJhaW50LCBmaWVsZCkge1xuICBjb25zdCBpbkFycmF5ID0gZmllbGQgJiYgZmllbGQudHlwZSAmJiBmaWVsZC50eXBlID09PSAnQXJyYXknO1xuICBpZiAodHlwZW9mIGNvbnN0cmFpbnQgIT09ICdvYmplY3QnIHx8ICFjb25zdHJhaW50KSB7XG4gICAgcmV0dXJuIENhbm5vdFRyYW5zZm9ybTtcbiAgfVxuICBjb25zdCB0cmFuc2Zvcm1GdW5jdGlvbiA9IGluQXJyYXlcbiAgICA/IHRyYW5zZm9ybUludGVyaW9yQXRvbVxuICAgIDogdHJhbnNmb3JtVG9wTGV2ZWxBdG9tO1xuICBjb25zdCB0cmFuc2Zvcm1lciA9IGF0b20gPT4ge1xuICAgIGNvbnN0IHJlc3VsdCA9IHRyYW5zZm9ybUZ1bmN0aW9uKGF0b20sIGZpZWxkKTtcbiAgICBpZiAocmVzdWx0ID09PSBDYW5ub3RUcmFuc2Zvcm0pIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICBgYmFkIGF0b206ICR7SlNPTi5zdHJpbmdpZnkoYXRvbSl9YFxuICAgICAgKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcbiAgLy8ga2V5cyBpcyB0aGUgY29uc3RyYWludHMgaW4gcmV2ZXJzZSBhbHBoYWJldGljYWwgb3JkZXIuXG4gIC8vIFRoaXMgaXMgYSBoYWNrIHNvIHRoYXQ6XG4gIC8vICAgJHJlZ2V4IGlzIGhhbmRsZWQgYmVmb3JlICRvcHRpb25zXG4gIC8vICAgJG5lYXJTcGhlcmUgaXMgaGFuZGxlZCBiZWZvcmUgJG1heERpc3RhbmNlXG4gIHZhciBrZXlzID0gT2JqZWN0LmtleXMoY29uc3RyYWludClcbiAgICAuc29ydCgpXG4gICAgLnJldmVyc2UoKTtcbiAgdmFyIGFuc3dlciA9IHt9O1xuICBmb3IgKHZhciBrZXkgb2Yga2V5cykge1xuICAgIHN3aXRjaCAoa2V5KSB7XG4gICAgICBjYXNlICckbHQnOlxuICAgICAgY2FzZSAnJGx0ZSc6XG4gICAgICBjYXNlICckZ3QnOlxuICAgICAgY2FzZSAnJGd0ZSc6XG4gICAgICBjYXNlICckZXhpc3RzJzpcbiAgICAgIGNhc2UgJyRuZSc6XG4gICAgICBjYXNlICckZXEnOiB7XG4gICAgICAgIGNvbnN0IHZhbCA9IGNvbnN0cmFpbnRba2V5XTtcbiAgICAgICAgaWYgKHZhbCAmJiB0eXBlb2YgdmFsID09PSAnb2JqZWN0JyAmJiB2YWwuJHJlbGF0aXZlVGltZSkge1xuICAgICAgICAgIGlmIChmaWVsZCAmJiBmaWVsZC50eXBlICE9PSAnRGF0ZScpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgICAnJHJlbGF0aXZlVGltZSBjYW4gb25seSBiZSB1c2VkIHdpdGggRGF0ZSBmaWVsZCdcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgc3dpdGNoIChrZXkpIHtcbiAgICAgICAgICAgIGNhc2UgJyRleGlzdHMnOlxuICAgICAgICAgICAgY2FzZSAnJG5lJzpcbiAgICAgICAgICAgIGNhc2UgJyRlcSc6XG4gICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICAgICAgJyRyZWxhdGl2ZVRpbWUgY2FuIG9ubHkgYmUgdXNlZCB3aXRoIHRoZSAkbHQsICRsdGUsICRndCwgYW5kICRndGUgb3BlcmF0b3JzJ1xuICAgICAgICAgICAgICApO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHBhcnNlclJlc3VsdCA9IHJlbGF0aXZlVGltZVRvRGF0ZSh2YWwuJHJlbGF0aXZlVGltZSk7XG4gICAgICAgICAgaWYgKHBhcnNlclJlc3VsdC5zdGF0dXMgPT09ICdzdWNjZXNzJykge1xuICAgICAgICAgICAgYW5zd2VyW2tleV0gPSBwYXJzZXJSZXN1bHQucmVzdWx0O1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgbG9nLmluZm8oJ0Vycm9yIHdoaWxlIHBhcnNpbmcgcmVsYXRpdmUgZGF0ZScsIHBhcnNlclJlc3VsdCk7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgYGJhZCAkcmVsYXRpdmVUaW1lICgke2tleX0pIHZhbHVlLiAke3BhcnNlclJlc3VsdC5pbmZvfWBcbiAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgYW5zd2VyW2tleV0gPSB0cmFuc2Zvcm1lcih2YWwpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgY2FzZSAnJGluJzpcbiAgICAgIGNhc2UgJyRuaW4nOiB7XG4gICAgICAgIGNvbnN0IGFyciA9IGNvbnN0cmFpbnRba2V5XTtcbiAgICAgICAgaWYgKCEoYXJyIGluc3RhbmNlb2YgQXJyYXkpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgJ2JhZCAnICsga2V5ICsgJyB2YWx1ZSdcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGFuc3dlcltrZXldID0gXy5mbGF0TWFwKGFyciwgdmFsdWUgPT4ge1xuICAgICAgICAgIHJldHVybiAoYXRvbSA9PiB7XG4gICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShhdG9tKSkge1xuICAgICAgICAgICAgICByZXR1cm4gdmFsdWUubWFwKHRyYW5zZm9ybWVyKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHJldHVybiB0cmFuc2Zvcm1lcihhdG9tKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KSh2YWx1ZSk7XG4gICAgICAgIH0pO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgJyRhbGwnOiB7XG4gICAgICAgIGNvbnN0IGFyciA9IGNvbnN0cmFpbnRba2V5XTtcbiAgICAgICAgaWYgKCEoYXJyIGluc3RhbmNlb2YgQXJyYXkpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgJ2JhZCAnICsga2V5ICsgJyB2YWx1ZSdcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGFuc3dlcltrZXldID0gYXJyLm1hcCh0cmFuc2Zvcm1JbnRlcmlvckF0b20pO1xuXG4gICAgICAgIGNvbnN0IHZhbHVlcyA9IGFuc3dlcltrZXldO1xuICAgICAgICBpZiAoaXNBbnlWYWx1ZVJlZ2V4KHZhbHVlcykgJiYgIWlzQWxsVmFsdWVzUmVnZXhPck5vbmUodmFsdWVzKSkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICdBbGwgJGFsbCB2YWx1ZXMgbXVzdCBiZSBvZiByZWdleCB0eXBlIG9yIG5vbmU6ICcgKyB2YWx1ZXNcbiAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBjYXNlICckcmVnZXgnOlxuICAgICAgICB2YXIgcyA9IGNvbnN0cmFpbnRba2V5XTtcbiAgICAgICAgaWYgKHR5cGVvZiBzICE9PSAnc3RyaW5nJykge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdiYWQgcmVnZXg6ICcgKyBzKTtcbiAgICAgICAgfVxuICAgICAgICBhbnN3ZXJba2V5XSA9IHM7XG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBjYXNlICckY29udGFpbmVkQnknOiB7XG4gICAgICAgIGNvbnN0IGFyciA9IGNvbnN0cmFpbnRba2V5XTtcbiAgICAgICAgaWYgKCEoYXJyIGluc3RhbmNlb2YgQXJyYXkpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgYGJhZCAkY29udGFpbmVkQnk6IHNob3VsZCBiZSBhbiBhcnJheWBcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGFuc3dlci4kZWxlbU1hdGNoID0ge1xuICAgICAgICAgICRuaW46IGFyci5tYXAodHJhbnNmb3JtZXIpLFxuICAgICAgICB9O1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgJyRvcHRpb25zJzpcbiAgICAgICAgYW5zd2VyW2tleV0gPSBjb25zdHJhaW50W2tleV07XG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBjYXNlICckdGV4dCc6IHtcbiAgICAgICAgY29uc3Qgc2VhcmNoID0gY29uc3RyYWludFtrZXldLiRzZWFyY2g7XG4gICAgICAgIGlmICh0eXBlb2Ygc2VhcmNoICE9PSAnb2JqZWN0Jykge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgIGBiYWQgJHRleHQ6ICRzZWFyY2gsIHNob3VsZCBiZSBvYmplY3RgXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXNlYXJjaC4kdGVybSB8fCB0eXBlb2Ygc2VhcmNoLiR0ZXJtICE9PSAnc3RyaW5nJykge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgIGBiYWQgJHRleHQ6ICR0ZXJtLCBzaG91bGQgYmUgc3RyaW5nYFxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYW5zd2VyW2tleV0gPSB7XG4gICAgICAgICAgICAkc2VhcmNoOiBzZWFyY2guJHRlcm0sXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc2VhcmNoLiRsYW5ndWFnZSAmJiB0eXBlb2Ygc2VhcmNoLiRsYW5ndWFnZSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICBgYmFkICR0ZXh0OiAkbGFuZ3VhZ2UsIHNob3VsZCBiZSBzdHJpbmdgXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIGlmIChzZWFyY2guJGxhbmd1YWdlKSB7XG4gICAgICAgICAgYW5zd2VyW2tleV0uJGxhbmd1YWdlID0gc2VhcmNoLiRsYW5ndWFnZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoXG4gICAgICAgICAgc2VhcmNoLiRjYXNlU2Vuc2l0aXZlICYmXG4gICAgICAgICAgdHlwZW9mIHNlYXJjaC4kY2FzZVNlbnNpdGl2ZSAhPT0gJ2Jvb2xlYW4nXG4gICAgICAgICkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgIGBiYWQgJHRleHQ6ICRjYXNlU2Vuc2l0aXZlLCBzaG91bGQgYmUgYm9vbGVhbmBcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2UgaWYgKHNlYXJjaC4kY2FzZVNlbnNpdGl2ZSkge1xuICAgICAgICAgIGFuc3dlcltrZXldLiRjYXNlU2Vuc2l0aXZlID0gc2VhcmNoLiRjYXNlU2Vuc2l0aXZlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChcbiAgICAgICAgICBzZWFyY2guJGRpYWNyaXRpY1NlbnNpdGl2ZSAmJlxuICAgICAgICAgIHR5cGVvZiBzZWFyY2guJGRpYWNyaXRpY1NlbnNpdGl2ZSAhPT0gJ2Jvb2xlYW4nXG4gICAgICAgICkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgIGBiYWQgJHRleHQ6ICRkaWFjcml0aWNTZW5zaXRpdmUsIHNob3VsZCBiZSBib29sZWFuYFxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSBpZiAoc2VhcmNoLiRkaWFjcml0aWNTZW5zaXRpdmUpIHtcbiAgICAgICAgICBhbnN3ZXJba2V5XS4kZGlhY3JpdGljU2Vuc2l0aXZlID0gc2VhcmNoLiRkaWFjcml0aWNTZW5zaXRpdmU7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBjYXNlICckbmVhclNwaGVyZSc6XG4gICAgICAgIHZhciBwb2ludCA9IGNvbnN0cmFpbnRba2V5XTtcbiAgICAgICAgYW5zd2VyW2tleV0gPSBbcG9pbnQubG9uZ2l0dWRlLCBwb2ludC5sYXRpdHVkZV07XG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBjYXNlICckbWF4RGlzdGFuY2UnOlxuICAgICAgICBhbnN3ZXJba2V5XSA9IGNvbnN0cmFpbnRba2V5XTtcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIC8vIFRoZSBTREtzIGRvbid0IHNlZW0gdG8gdXNlIHRoZXNlIGJ1dCB0aGV5IGFyZSBkb2N1bWVudGVkIGluIHRoZVxuICAgICAgLy8gUkVTVCBBUEkgZG9jcy5cbiAgICAgIGNhc2UgJyRtYXhEaXN0YW5jZUluUmFkaWFucyc6XG4gICAgICAgIGFuc3dlclsnJG1heERpc3RhbmNlJ10gPSBjb25zdHJhaW50W2tleV07XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnJG1heERpc3RhbmNlSW5NaWxlcyc6XG4gICAgICAgIGFuc3dlclsnJG1heERpc3RhbmNlJ10gPSBjb25zdHJhaW50W2tleV0gLyAzOTU5O1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJyRtYXhEaXN0YW5jZUluS2lsb21ldGVycyc6XG4gICAgICAgIGFuc3dlclsnJG1heERpc3RhbmNlJ10gPSBjb25zdHJhaW50W2tleV0gLyA2MzcxO1xuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSAnJHNlbGVjdCc6XG4gICAgICBjYXNlICckZG9udFNlbGVjdCc6XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5DT01NQU5EX1VOQVZBSUxBQkxFLFxuICAgICAgICAgICd0aGUgJyArIGtleSArICcgY29uc3RyYWludCBpcyBub3Qgc3VwcG9ydGVkIHlldCdcbiAgICAgICAgKTtcblxuICAgICAgY2FzZSAnJHdpdGhpbic6XG4gICAgICAgIHZhciBib3ggPSBjb25zdHJhaW50W2tleV1bJyRib3gnXTtcbiAgICAgICAgaWYgKCFib3ggfHwgYm94Lmxlbmd0aCAhPSAyKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgJ21hbGZvcm1hdHRlZCAkd2l0aGluIGFyZydcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGFuc3dlcltrZXldID0ge1xuICAgICAgICAgICRib3g6IFtcbiAgICAgICAgICAgIFtib3hbMF0ubG9uZ2l0dWRlLCBib3hbMF0ubGF0aXR1ZGVdLFxuICAgICAgICAgICAgW2JveFsxXS5sb25naXR1ZGUsIGJveFsxXS5sYXRpdHVkZV0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfTtcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIGNhc2UgJyRnZW9XaXRoaW4nOiB7XG4gICAgICAgIGNvbnN0IHBvbHlnb24gPSBjb25zdHJhaW50W2tleV1bJyRwb2x5Z29uJ107XG4gICAgICAgIGNvbnN0IGNlbnRlclNwaGVyZSA9IGNvbnN0cmFpbnRba2V5XVsnJGNlbnRlclNwaGVyZSddO1xuICAgICAgICBpZiAocG9seWdvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgbGV0IHBvaW50cztcbiAgICAgICAgICBpZiAodHlwZW9mIHBvbHlnb24gPT09ICdvYmplY3QnICYmIHBvbHlnb24uX190eXBlID09PSAnUG9seWdvbicpIHtcbiAgICAgICAgICAgIGlmICghcG9seWdvbi5jb29yZGluYXRlcyB8fCBwb2x5Z29uLmNvb3JkaW5hdGVzLmxlbmd0aCA8IDMpIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICAgICAnYmFkICRnZW9XaXRoaW4gdmFsdWU7IFBvbHlnb24uY29vcmRpbmF0ZXMgc2hvdWxkIGNvbnRhaW4gYXQgbGVhc3QgMyBsb24vbGF0IHBhaXJzJ1xuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcG9pbnRzID0gcG9seWdvbi5jb29yZGluYXRlcztcbiAgICAgICAgICB9IGVsc2UgaWYgKHBvbHlnb24gaW5zdGFuY2VvZiBBcnJheSkge1xuICAgICAgICAgICAgaWYgKHBvbHlnb24ubGVuZ3RoIDwgMykge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgICAgICdiYWQgJGdlb1dpdGhpbiB2YWx1ZTsgJHBvbHlnb24gc2hvdWxkIGNvbnRhaW4gYXQgbGVhc3QgMyBHZW9Qb2ludHMnXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwb2ludHMgPSBwb2x5Z29uO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICAgXCJiYWQgJGdlb1dpdGhpbiB2YWx1ZTsgJHBvbHlnb24gc2hvdWxkIGJlIFBvbHlnb24gb2JqZWN0IG9yIEFycmF5IG9mIFBhcnNlLkdlb1BvaW50J3NcIlxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcG9pbnRzID0gcG9pbnRzLm1hcChwb2ludCA9PiB7XG4gICAgICAgICAgICBpZiAocG9pbnQgaW5zdGFuY2VvZiBBcnJheSAmJiBwb2ludC5sZW5ndGggPT09IDIpIHtcbiAgICAgICAgICAgICAgUGFyc2UuR2VvUG9pbnQuX3ZhbGlkYXRlKHBvaW50WzFdLCBwb2ludFswXSk7XG4gICAgICAgICAgICAgIHJldHVybiBwb2ludDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghR2VvUG9pbnRDb2Rlci5pc1ZhbGlkSlNPTihwb2ludCkpIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICAgICAnYmFkICRnZW9XaXRoaW4gdmFsdWUnXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBQYXJzZS5HZW9Qb2ludC5fdmFsaWRhdGUocG9pbnQubGF0aXR1ZGUsIHBvaW50LmxvbmdpdHVkZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gW3BvaW50LmxvbmdpdHVkZSwgcG9pbnQubGF0aXR1ZGVdO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIGFuc3dlcltrZXldID0ge1xuICAgICAgICAgICAgJHBvbHlnb246IHBvaW50cyxcbiAgICAgICAgICB9O1xuICAgICAgICB9IGVsc2UgaWYgKGNlbnRlclNwaGVyZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgaWYgKCEoY2VudGVyU3BoZXJlIGluc3RhbmNlb2YgQXJyYXkpIHx8IGNlbnRlclNwaGVyZS5sZW5ndGggPCAyKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICAgJ2JhZCAkZ2VvV2l0aGluIHZhbHVlOyAkY2VudGVyU3BoZXJlIHNob3VsZCBiZSBhbiBhcnJheSBvZiBQYXJzZS5HZW9Qb2ludCBhbmQgZGlzdGFuY2UnXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBHZXQgcG9pbnQsIGNvbnZlcnQgdG8gZ2VvIHBvaW50IGlmIG5lY2Vzc2FyeSBhbmQgdmFsaWRhdGVcbiAgICAgICAgICBsZXQgcG9pbnQgPSBjZW50ZXJTcGhlcmVbMF07XG4gICAgICAgICAgaWYgKHBvaW50IGluc3RhbmNlb2YgQXJyYXkgJiYgcG9pbnQubGVuZ3RoID09PSAyKSB7XG4gICAgICAgICAgICBwb2ludCA9IG5ldyBQYXJzZS5HZW9Qb2ludChwb2ludFsxXSwgcG9pbnRbMF0pO1xuICAgICAgICAgIH0gZWxzZSBpZiAoIUdlb1BvaW50Q29kZXIuaXNWYWxpZEpTT04ocG9pbnQpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICAgJ2JhZCAkZ2VvV2l0aGluIHZhbHVlOyAkY2VudGVyU3BoZXJlIGdlbyBwb2ludCBpbnZhbGlkJ1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgUGFyc2UuR2VvUG9pbnQuX3ZhbGlkYXRlKHBvaW50LmxhdGl0dWRlLCBwb2ludC5sb25naXR1ZGUpO1xuICAgICAgICAgIC8vIEdldCBkaXN0YW5jZSBhbmQgdmFsaWRhdGVcbiAgICAgICAgICBjb25zdCBkaXN0YW5jZSA9IGNlbnRlclNwaGVyZVsxXTtcbiAgICAgICAgICBpZiAoaXNOYU4oZGlzdGFuY2UpIHx8IGRpc3RhbmNlIDwgMCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICAgICdiYWQgJGdlb1dpdGhpbiB2YWx1ZTsgJGNlbnRlclNwaGVyZSBkaXN0YW5jZSBpbnZhbGlkJ1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYW5zd2VyW2tleV0gPSB7XG4gICAgICAgICAgICAkY2VudGVyU3BoZXJlOiBbW3BvaW50LmxvbmdpdHVkZSwgcG9pbnQubGF0aXR1ZGVdLCBkaXN0YW5jZV0sXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgJyRnZW9JbnRlcnNlY3RzJzoge1xuICAgICAgICBjb25zdCBwb2ludCA9IGNvbnN0cmFpbnRba2V5XVsnJHBvaW50J107XG4gICAgICAgIGlmICghR2VvUG9pbnRDb2Rlci5pc1ZhbGlkSlNPTihwb2ludCkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICAnYmFkICRnZW9JbnRlcnNlY3QgdmFsdWU7ICRwb2ludCBzaG91bGQgYmUgR2VvUG9pbnQnXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBQYXJzZS5HZW9Qb2ludC5fdmFsaWRhdGUocG9pbnQubGF0aXR1ZGUsIHBvaW50LmxvbmdpdHVkZSk7XG4gICAgICAgIH1cbiAgICAgICAgYW5zd2VyW2tleV0gPSB7XG4gICAgICAgICAgJGdlb21ldHJ5OiB7XG4gICAgICAgICAgICB0eXBlOiAnUG9pbnQnLFxuICAgICAgICAgICAgY29vcmRpbmF0ZXM6IFtwb2ludC5sb25naXR1ZGUsIHBvaW50LmxhdGl0dWRlXSxcbiAgICAgICAgICB9LFxuICAgICAgICB9O1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmIChrZXkubWF0Y2goL15cXCQrLykpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICAnYmFkIGNvbnN0cmFpbnQ6ICcgKyBrZXlcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBDYW5ub3RUcmFuc2Zvcm07XG4gICAgfVxuICB9XG4gIHJldHVybiBhbnN3ZXI7XG59XG5cbi8vIFRyYW5zZm9ybXMgYW4gdXBkYXRlIG9wZXJhdG9yIGZyb20gUkVTVCBmb3JtYXQgdG8gbW9uZ28gZm9ybWF0LlxuLy8gVG8gYmUgdHJhbnNmb3JtZWQsIHRoZSBpbnB1dCBzaG91bGQgaGF2ZSBhbiBfX29wIGZpZWxkLlxuLy8gSWYgZmxhdHRlbiBpcyB0cnVlLCB0aGlzIHdpbGwgZmxhdHRlbiBvcGVyYXRvcnMgdG8gdGhlaXIgc3RhdGljXG4vLyBkYXRhIGZvcm1hdC4gRm9yIGV4YW1wbGUsIGFuIGluY3JlbWVudCBvZiAyIHdvdWxkIHNpbXBseSBiZWNvbWUgYVxuLy8gMi5cbi8vIFRoZSBvdXRwdXQgZm9yIGEgbm9uLWZsYXR0ZW5lZCBvcGVyYXRvciBpcyBhIGhhc2ggd2l0aCBfX29wIGJlaW5nXG4vLyB0aGUgbW9uZ28gb3AsIGFuZCBhcmcgYmVpbmcgdGhlIGFyZ3VtZW50LlxuLy8gVGhlIG91dHB1dCBmb3IgYSBmbGF0dGVuZWQgb3BlcmF0b3IgaXMganVzdCBhIHZhbHVlLlxuLy8gUmV0dXJucyB1bmRlZmluZWQgaWYgdGhpcyBzaG91bGQgYmUgYSBuby1vcC5cblxuZnVuY3Rpb24gdHJhbnNmb3JtVXBkYXRlT3BlcmF0b3IoeyBfX29wLCBhbW91bnQsIG9iamVjdHMgfSwgZmxhdHRlbikge1xuICBzd2l0Y2ggKF9fb3ApIHtcbiAgICBjYXNlICdEZWxldGUnOlxuICAgICAgaWYgKGZsYXR0ZW4pIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiB7IF9fb3A6ICckdW5zZXQnLCBhcmc6ICcnIH07XG4gICAgICB9XG5cbiAgICBjYXNlICdJbmNyZW1lbnQnOlxuICAgICAgaWYgKHR5cGVvZiBhbW91bnQgIT09ICdudW1iZXInKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgJ2luY3JlbWVudGluZyBtdXN0IHByb3ZpZGUgYSBudW1iZXInXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBpZiAoZmxhdHRlbikge1xuICAgICAgICByZXR1cm4gYW1vdW50O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIHsgX19vcDogJyRpbmMnLCBhcmc6IGFtb3VudCB9O1xuICAgICAgfVxuXG4gICAgY2FzZSAnQWRkJzpcbiAgICBjYXNlICdBZGRVbmlxdWUnOlxuICAgICAgaWYgKCEob2JqZWN0cyBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICdvYmplY3RzIHRvIGFkZCBtdXN0IGJlIGFuIGFycmF5J1xuICAgICAgICApO1xuICAgICAgfVxuICAgICAgdmFyIHRvQWRkID0gb2JqZWN0cy5tYXAodHJhbnNmb3JtSW50ZXJpb3JBdG9tKTtcbiAgICAgIGlmIChmbGF0dGVuKSB7XG4gICAgICAgIHJldHVybiB0b0FkZDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBtb25nb09wID0ge1xuICAgICAgICAgIEFkZDogJyRwdXNoJyxcbiAgICAgICAgICBBZGRVbmlxdWU6ICckYWRkVG9TZXQnLFxuICAgICAgICB9W19fb3BdO1xuICAgICAgICByZXR1cm4geyBfX29wOiBtb25nb09wLCBhcmc6IHsgJGVhY2g6IHRvQWRkIH0gfTtcbiAgICAgIH1cblxuICAgIGNhc2UgJ1JlbW92ZSc6XG4gICAgICBpZiAoIShvYmplY3RzIGluc3RhbmNlb2YgQXJyYXkpKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgJ29iamVjdHMgdG8gcmVtb3ZlIG11c3QgYmUgYW4gYXJyYXknXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICB2YXIgdG9SZW1vdmUgPSBvYmplY3RzLm1hcCh0cmFuc2Zvcm1JbnRlcmlvckF0b20pO1xuICAgICAgaWYgKGZsYXR0ZW4pIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIHsgX19vcDogJyRwdWxsQWxsJywgYXJnOiB0b1JlbW92ZSB9O1xuICAgICAgfVxuXG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuQ09NTUFORF9VTkFWQUlMQUJMRSxcbiAgICAgICAgYFRoZSAke19fb3B9IG9wZXJhdG9yIGlzIG5vdCBzdXBwb3J0ZWQgeWV0LmBcbiAgICAgICk7XG4gIH1cbn1cbmZ1bmN0aW9uIG1hcFZhbHVlcyhvYmplY3QsIGl0ZXJhdG9yKSB7XG4gIGNvbnN0IHJlc3VsdCA9IHt9O1xuICBPYmplY3Qua2V5cyhvYmplY3QpLmZvckVhY2goa2V5ID0+IHtcbiAgICByZXN1bHRba2V5XSA9IGl0ZXJhdG9yKG9iamVjdFtrZXldKTtcbiAgfSk7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmNvbnN0IG5lc3RlZE1vbmdvT2JqZWN0VG9OZXN0ZWRQYXJzZU9iamVjdCA9IG1vbmdvT2JqZWN0ID0+IHtcbiAgc3dpdGNoICh0eXBlb2YgbW9uZ29PYmplY3QpIHtcbiAgICBjYXNlICdzdHJpbmcnOlxuICAgIGNhc2UgJ251bWJlcic6XG4gICAgY2FzZSAnYm9vbGVhbic6XG4gICAgY2FzZSAndW5kZWZpbmVkJzpcbiAgICAgIHJldHVybiBtb25nb09iamVjdDtcbiAgICBjYXNlICdzeW1ib2wnOlxuICAgIGNhc2UgJ2Z1bmN0aW9uJzpcbiAgICAgIHRocm93ICdiYWQgdmFsdWUgaW4gbmVzdGVkTW9uZ29PYmplY3RUb05lc3RlZFBhcnNlT2JqZWN0JztcbiAgICBjYXNlICdvYmplY3QnOlxuICAgICAgaWYgKG1vbmdvT2JqZWN0ID09PSBudWxsKSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgICAgaWYgKG1vbmdvT2JqZWN0IGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICAgICAgcmV0dXJuIG1vbmdvT2JqZWN0Lm1hcChuZXN0ZWRNb25nb09iamVjdFRvTmVzdGVkUGFyc2VPYmplY3QpO1xuICAgICAgfVxuXG4gICAgICBpZiAobW9uZ29PYmplY3QgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICAgIHJldHVybiBQYXJzZS5fZW5jb2RlKG1vbmdvT2JqZWN0KTtcbiAgICAgIH1cblxuICAgICAgaWYgKG1vbmdvT2JqZWN0IGluc3RhbmNlb2YgbW9uZ29kYi5Mb25nKSB7XG4gICAgICAgIHJldHVybiBtb25nb09iamVjdC50b051bWJlcigpO1xuICAgICAgfVxuXG4gICAgICBpZiAobW9uZ29PYmplY3QgaW5zdGFuY2VvZiBtb25nb2RiLkRvdWJsZSkge1xuICAgICAgICByZXR1cm4gbW9uZ29PYmplY3QudmFsdWU7XG4gICAgICB9XG5cbiAgICAgIGlmIChCeXRlc0NvZGVyLmlzVmFsaWREYXRhYmFzZU9iamVjdChtb25nb09iamVjdCkpIHtcbiAgICAgICAgcmV0dXJuIEJ5dGVzQ29kZXIuZGF0YWJhc2VUb0pTT04obW9uZ29PYmplY3QpO1xuICAgICAgfVxuXG4gICAgICBpZiAoXG4gICAgICAgIG1vbmdvT2JqZWN0Lmhhc093blByb3BlcnR5KCdfX3R5cGUnKSAmJlxuICAgICAgICBtb25nb09iamVjdC5fX3R5cGUgPT0gJ0RhdGUnICYmXG4gICAgICAgIG1vbmdvT2JqZWN0LmlzbyBpbnN0YW5jZW9mIERhdGVcbiAgICAgICkge1xuICAgICAgICBtb25nb09iamVjdC5pc28gPSBtb25nb09iamVjdC5pc28udG9KU09OKCk7XG4gICAgICAgIHJldHVybiBtb25nb09iamVjdDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIG1hcFZhbHVlcyhtb25nb09iamVjdCwgbmVzdGVkTW9uZ29PYmplY3RUb05lc3RlZFBhcnNlT2JqZWN0KTtcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgJ3Vua25vd24ganMgdHlwZSc7XG4gIH1cbn07XG5cbmNvbnN0IHRyYW5zZm9ybVBvaW50ZXJTdHJpbmcgPSAoc2NoZW1hLCBmaWVsZCwgcG9pbnRlclN0cmluZykgPT4ge1xuICBjb25zdCBvYmpEYXRhID0gcG9pbnRlclN0cmluZy5zcGxpdCgnJCcpO1xuICBpZiAob2JqRGF0YVswXSAhPT0gc2NoZW1hLmZpZWxkc1tmaWVsZF0udGFyZ2V0Q2xhc3MpIHtcbiAgICB0aHJvdyAncG9pbnRlciB0byBpbmNvcnJlY3QgY2xhc3NOYW1lJztcbiAgfVxuICByZXR1cm4ge1xuICAgIF9fdHlwZTogJ1BvaW50ZXInLFxuICAgIGNsYXNzTmFtZTogb2JqRGF0YVswXSxcbiAgICBvYmplY3RJZDogb2JqRGF0YVsxXSxcbiAgfTtcbn07XG5cbi8vIENvbnZlcnRzIGZyb20gYSBtb25nby1mb3JtYXQgb2JqZWN0IHRvIGEgUkVTVC1mb3JtYXQgb2JqZWN0LlxuLy8gRG9lcyBub3Qgc3RyaXAgb3V0IGFueXRoaW5nIGJhc2VkIG9uIGEgbGFjayBvZiBhdXRoZW50aWNhdGlvbi5cbmNvbnN0IG1vbmdvT2JqZWN0VG9QYXJzZU9iamVjdCA9IChjbGFzc05hbWUsIG1vbmdvT2JqZWN0LCBzY2hlbWEpID0+IHtcbiAgc3dpdGNoICh0eXBlb2YgbW9uZ29PYmplY3QpIHtcbiAgICBjYXNlICdzdHJpbmcnOlxuICAgIGNhc2UgJ251bWJlcic6XG4gICAgY2FzZSAnYm9vbGVhbic6XG4gICAgY2FzZSAndW5kZWZpbmVkJzpcbiAgICAgIHJldHVybiBtb25nb09iamVjdDtcbiAgICBjYXNlICdzeW1ib2wnOlxuICAgIGNhc2UgJ2Z1bmN0aW9uJzpcbiAgICAgIHRocm93ICdiYWQgdmFsdWUgaW4gbW9uZ29PYmplY3RUb1BhcnNlT2JqZWN0JztcbiAgICBjYXNlICdvYmplY3QnOiB7XG4gICAgICBpZiAobW9uZ29PYmplY3QgPT09IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgICBpZiAobW9uZ29PYmplY3QgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgICAgICByZXR1cm4gbW9uZ29PYmplY3QubWFwKG5lc3RlZE1vbmdvT2JqZWN0VG9OZXN0ZWRQYXJzZU9iamVjdCk7XG4gICAgICB9XG5cbiAgICAgIGlmIChtb25nb09iamVjdCBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICAgICAgcmV0dXJuIFBhcnNlLl9lbmNvZGUobW9uZ29PYmplY3QpO1xuICAgICAgfVxuXG4gICAgICBpZiAobW9uZ29PYmplY3QgaW5zdGFuY2VvZiBtb25nb2RiLkxvbmcpIHtcbiAgICAgICAgcmV0dXJuIG1vbmdvT2JqZWN0LnRvTnVtYmVyKCk7XG4gICAgICB9XG5cbiAgICAgIGlmIChtb25nb09iamVjdCBpbnN0YW5jZW9mIG1vbmdvZGIuRG91YmxlKSB7XG4gICAgICAgIHJldHVybiBtb25nb09iamVjdC52YWx1ZTtcbiAgICAgIH1cblxuICAgICAgaWYgKEJ5dGVzQ29kZXIuaXNWYWxpZERhdGFiYXNlT2JqZWN0KG1vbmdvT2JqZWN0KSkge1xuICAgICAgICByZXR1cm4gQnl0ZXNDb2Rlci5kYXRhYmFzZVRvSlNPTihtb25nb09iamVjdCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlc3RPYmplY3QgPSB7fTtcbiAgICAgIGlmIChtb25nb09iamVjdC5fcnBlcm0gfHwgbW9uZ29PYmplY3QuX3dwZXJtKSB7XG4gICAgICAgIHJlc3RPYmplY3QuX3JwZXJtID0gbW9uZ29PYmplY3QuX3JwZXJtIHx8IFtdO1xuICAgICAgICByZXN0T2JqZWN0Ll93cGVybSA9IG1vbmdvT2JqZWN0Ll93cGVybSB8fCBbXTtcbiAgICAgICAgZGVsZXRlIG1vbmdvT2JqZWN0Ll9ycGVybTtcbiAgICAgICAgZGVsZXRlIG1vbmdvT2JqZWN0Ll93cGVybTtcbiAgICAgIH1cblxuICAgICAgZm9yICh2YXIga2V5IGluIG1vbmdvT2JqZWN0KSB7XG4gICAgICAgIHN3aXRjaCAoa2V5KSB7XG4gICAgICAgICAgY2FzZSAnX2lkJzpcbiAgICAgICAgICAgIHJlc3RPYmplY3RbJ29iamVjdElkJ10gPSAnJyArIG1vbmdvT2JqZWN0W2tleV07XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlICdfaGFzaGVkX3Bhc3N3b3JkJzpcbiAgICAgICAgICAgIHJlc3RPYmplY3QuX2hhc2hlZF9wYXNzd29yZCA9IG1vbmdvT2JqZWN0W2tleV07XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlICdfYWNsJzpcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGNhc2UgJ19lbWFpbF92ZXJpZnlfdG9rZW4nOlxuICAgICAgICAgIGNhc2UgJ19wZXJpc2hhYmxlX3Rva2VuJzpcbiAgICAgICAgICBjYXNlICdfcGVyaXNoYWJsZV90b2tlbl9leHBpcmVzX2F0JzpcbiAgICAgICAgICBjYXNlICdfcGFzc3dvcmRfY2hhbmdlZF9hdCc6XG4gICAgICAgICAgY2FzZSAnX3RvbWJzdG9uZSc6XG4gICAgICAgICAgY2FzZSAnX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0JzpcbiAgICAgICAgICBjYXNlICdfYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQnOlxuICAgICAgICAgIGNhc2UgJ19mYWlsZWRfbG9naW5fY291bnQnOlxuICAgICAgICAgIGNhc2UgJ19wYXNzd29yZF9oaXN0b3J5JzpcbiAgICAgICAgICAgIC8vIFRob3NlIGtleXMgd2lsbCBiZSBkZWxldGVkIGlmIG5lZWRlZCBpbiB0aGUgREIgQ29udHJvbGxlclxuICAgICAgICAgICAgcmVzdE9iamVjdFtrZXldID0gbW9uZ29PYmplY3Rba2V5XTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGNhc2UgJ19zZXNzaW9uX3Rva2VuJzpcbiAgICAgICAgICAgIHJlc3RPYmplY3RbJ3Nlc3Npb25Ub2tlbiddID0gbW9uZ29PYmplY3Rba2V5XTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGNhc2UgJ3VwZGF0ZWRBdCc6XG4gICAgICAgICAgY2FzZSAnX3VwZGF0ZWRfYXQnOlxuICAgICAgICAgICAgcmVzdE9iamVjdFsndXBkYXRlZEF0J10gPSBQYXJzZS5fZW5jb2RlKFxuICAgICAgICAgICAgICBuZXcgRGF0ZShtb25nb09iamVjdFtrZXldKVxuICAgICAgICAgICAgKS5pc287XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlICdjcmVhdGVkQXQnOlxuICAgICAgICAgIGNhc2UgJ19jcmVhdGVkX2F0JzpcbiAgICAgICAgICAgIHJlc3RPYmplY3RbJ2NyZWF0ZWRBdCddID0gUGFyc2UuX2VuY29kZShcbiAgICAgICAgICAgICAgbmV3IERhdGUobW9uZ29PYmplY3Rba2V5XSlcbiAgICAgICAgICAgICkuaXNvO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgY2FzZSAnZXhwaXJlc0F0JzpcbiAgICAgICAgICBjYXNlICdfZXhwaXJlc0F0JzpcbiAgICAgICAgICAgIHJlc3RPYmplY3RbJ2V4cGlyZXNBdCddID0gUGFyc2UuX2VuY29kZShuZXcgRGF0ZShtb25nb09iamVjdFtrZXldKSk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlICdsYXN0VXNlZCc6XG4gICAgICAgICAgY2FzZSAnX2xhc3RfdXNlZCc6XG4gICAgICAgICAgICByZXN0T2JqZWN0WydsYXN0VXNlZCddID0gUGFyc2UuX2VuY29kZShcbiAgICAgICAgICAgICAgbmV3IERhdGUobW9uZ29PYmplY3Rba2V5XSlcbiAgICAgICAgICAgICkuaXNvO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgY2FzZSAndGltZXNVc2VkJzpcbiAgICAgICAgICBjYXNlICd0aW1lc191c2VkJzpcbiAgICAgICAgICAgIHJlc3RPYmplY3RbJ3RpbWVzVXNlZCddID0gbW9uZ29PYmplY3Rba2V5XTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAvLyBDaGVjayBvdGhlciBhdXRoIGRhdGEga2V5c1xuICAgICAgICAgICAgdmFyIGF1dGhEYXRhTWF0Y2ggPSBrZXkubWF0Y2goL15fYXV0aF9kYXRhXyhbYS16QS1aMC05X10rKSQvKTtcbiAgICAgICAgICAgIGlmIChhdXRoRGF0YU1hdGNoKSB7XG4gICAgICAgICAgICAgIHZhciBwcm92aWRlciA9IGF1dGhEYXRhTWF0Y2hbMV07XG4gICAgICAgICAgICAgIHJlc3RPYmplY3RbJ2F1dGhEYXRhJ10gPSByZXN0T2JqZWN0WydhdXRoRGF0YSddIHx8IHt9O1xuICAgICAgICAgICAgICByZXN0T2JqZWN0WydhdXRoRGF0YSddW3Byb3ZpZGVyXSA9IG1vbmdvT2JqZWN0W2tleV07XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoa2V5LmluZGV4T2YoJ19wXycpID09IDApIHtcbiAgICAgICAgICAgICAgdmFyIG5ld0tleSA9IGtleS5zdWJzdHJpbmcoMyk7XG4gICAgICAgICAgICAgIGlmICghc2NoZW1hLmZpZWxkc1tuZXdLZXldKSB7XG4gICAgICAgICAgICAgICAgbG9nLmluZm8oXG4gICAgICAgICAgICAgICAgICAndHJhbnNmb3JtLmpzJyxcbiAgICAgICAgICAgICAgICAgICdGb3VuZCBhIHBvaW50ZXIgY29sdW1uIG5vdCBpbiB0aGUgc2NoZW1hLCBkcm9wcGluZyBpdC4nLFxuICAgICAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICAgICAgbmV3S2V5XG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBpZiAoc2NoZW1hLmZpZWxkc1tuZXdLZXldLnR5cGUgIT09ICdQb2ludGVyJykge1xuICAgICAgICAgICAgICAgIGxvZy5pbmZvKFxuICAgICAgICAgICAgICAgICAgJ3RyYW5zZm9ybS5qcycsXG4gICAgICAgICAgICAgICAgICAnRm91bmQgYSBwb2ludGVyIGluIGEgbm9uLXBvaW50ZXIgY29sdW1uLCBkcm9wcGluZyBpdC4nLFxuICAgICAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICAgICAga2V5XG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBpZiAobW9uZ29PYmplY3Rba2V5XSA9PT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJlc3RPYmplY3RbbmV3S2V5XSA9IHRyYW5zZm9ybVBvaW50ZXJTdHJpbmcoXG4gICAgICAgICAgICAgICAgc2NoZW1hLFxuICAgICAgICAgICAgICAgIG5ld0tleSxcbiAgICAgICAgICAgICAgICBtb25nb09iamVjdFtrZXldXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChrZXlbMF0gPT0gJ18nICYmIGtleSAhPSAnX190eXBlJykge1xuICAgICAgICAgICAgICB0aHJvdyAnYmFkIGtleSBpbiB1bnRyYW5zZm9ybTogJyArIGtleTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHZhciB2YWx1ZSA9IG1vbmdvT2JqZWN0W2tleV07XG4gICAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgICBzY2hlbWEuZmllbGRzW2tleV0gJiZcbiAgICAgICAgICAgICAgICBzY2hlbWEuZmllbGRzW2tleV0udHlwZSA9PT0gJ0ZpbGUnICYmXG4gICAgICAgICAgICAgICAgRmlsZUNvZGVyLmlzVmFsaWREYXRhYmFzZU9iamVjdCh2YWx1ZSlcbiAgICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgcmVzdE9iamVjdFtrZXldID0gRmlsZUNvZGVyLmRhdGFiYXNlVG9KU09OKHZhbHVlKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgc2NoZW1hLmZpZWxkc1trZXldICYmXG4gICAgICAgICAgICAgICAgc2NoZW1hLmZpZWxkc1trZXldLnR5cGUgPT09ICdHZW9Qb2ludCcgJiZcbiAgICAgICAgICAgICAgICBHZW9Qb2ludENvZGVyLmlzVmFsaWREYXRhYmFzZU9iamVjdCh2YWx1ZSlcbiAgICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgcmVzdE9iamVjdFtrZXldID0gR2VvUG9pbnRDb2Rlci5kYXRhYmFzZVRvSlNPTih2YWx1ZSk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgIHNjaGVtYS5maWVsZHNba2V5XSAmJlxuICAgICAgICAgICAgICAgIHNjaGVtYS5maWVsZHNba2V5XS50eXBlID09PSAnUG9seWdvbicgJiZcbiAgICAgICAgICAgICAgICBQb2x5Z29uQ29kZXIuaXNWYWxpZERhdGFiYXNlT2JqZWN0KHZhbHVlKVxuICAgICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICByZXN0T2JqZWN0W2tleV0gPSBQb2x5Z29uQ29kZXIuZGF0YWJhc2VUb0pTT04odmFsdWUpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgICBzY2hlbWEuZmllbGRzW2tleV0gJiZcbiAgICAgICAgICAgICAgICBzY2hlbWEuZmllbGRzW2tleV0udHlwZSA9PT0gJ0J5dGVzJyAmJlxuICAgICAgICAgICAgICAgIEJ5dGVzQ29kZXIuaXNWYWxpZERhdGFiYXNlT2JqZWN0KHZhbHVlKVxuICAgICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICByZXN0T2JqZWN0W2tleV0gPSBCeXRlc0NvZGVyLmRhdGFiYXNlVG9KU09OKHZhbHVlKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVzdE9iamVjdFtrZXldID0gbmVzdGVkTW9uZ29PYmplY3RUb05lc3RlZFBhcnNlT2JqZWN0KFxuICAgICAgICAgICAgICBtb25nb09iamVjdFtrZXldXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlbGF0aW9uRmllbGROYW1lcyA9IE9iamVjdC5rZXlzKHNjaGVtYS5maWVsZHMpLmZpbHRlcihcbiAgICAgICAgZmllbGROYW1lID0+IHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnUmVsYXRpb24nXG4gICAgICApO1xuICAgICAgY29uc3QgcmVsYXRpb25GaWVsZHMgPSB7fTtcbiAgICAgIHJlbGF0aW9uRmllbGROYW1lcy5mb3JFYWNoKHJlbGF0aW9uRmllbGROYW1lID0+IHtcbiAgICAgICAgcmVsYXRpb25GaWVsZHNbcmVsYXRpb25GaWVsZE5hbWVdID0ge1xuICAgICAgICAgIF9fdHlwZTogJ1JlbGF0aW9uJyxcbiAgICAgICAgICBjbGFzc05hbWU6IHNjaGVtYS5maWVsZHNbcmVsYXRpb25GaWVsZE5hbWVdLnRhcmdldENsYXNzLFxuICAgICAgICB9O1xuICAgICAgfSk7XG5cbiAgICAgIHJldHVybiB7IC4uLnJlc3RPYmplY3QsIC4uLnJlbGF0aW9uRmllbGRzIH07XG4gICAgfVxuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyAndW5rbm93biBqcyB0eXBlJztcbiAgfVxufTtcblxudmFyIERhdGVDb2RlciA9IHtcbiAgSlNPTlRvRGF0YWJhc2UoanNvbikge1xuICAgIHJldHVybiBuZXcgRGF0ZShqc29uLmlzbyk7XG4gIH0sXG5cbiAgaXNWYWxpZEpTT04odmFsdWUpIHtcbiAgICByZXR1cm4gKFxuICAgICAgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB2YWx1ZSAhPT0gbnVsbCAmJiB2YWx1ZS5fX3R5cGUgPT09ICdEYXRlJ1xuICAgICk7XG4gIH0sXG59O1xuXG52YXIgQnl0ZXNDb2RlciA9IHtcbiAgYmFzZTY0UGF0dGVybjogbmV3IFJlZ0V4cChcbiAgICAnXig/OltBLVphLXowLTkrL117NH0pKig/OltBLVphLXowLTkrL117Mn09PXxbQS1aYS16MC05Ky9dezN9PSk/JCdcbiAgKSxcbiAgaXNCYXNlNjRWYWx1ZShvYmplY3QpIHtcbiAgICBpZiAodHlwZW9mIG9iamVjdCAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuYmFzZTY0UGF0dGVybi50ZXN0KG9iamVjdCk7XG4gIH0sXG5cbiAgZGF0YWJhc2VUb0pTT04ob2JqZWN0KSB7XG4gICAgbGV0IHZhbHVlO1xuICAgIGlmICh0aGlzLmlzQmFzZTY0VmFsdWUob2JqZWN0KSkge1xuICAgICAgdmFsdWUgPSBvYmplY3Q7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhbHVlID0gb2JqZWN0LmJ1ZmZlci50b1N0cmluZygnYmFzZTY0Jyk7XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICBfX3R5cGU6ICdCeXRlcycsXG4gICAgICBiYXNlNjQ6IHZhbHVlLFxuICAgIH07XG4gIH0sXG5cbiAgaXNWYWxpZERhdGFiYXNlT2JqZWN0KG9iamVjdCkge1xuICAgIHJldHVybiBvYmplY3QgaW5zdGFuY2VvZiBtb25nb2RiLkJpbmFyeSB8fCB0aGlzLmlzQmFzZTY0VmFsdWUob2JqZWN0KTtcbiAgfSxcblxuICBKU09OVG9EYXRhYmFzZShqc29uKSB7XG4gICAgcmV0dXJuIG5ldyBtb25nb2RiLkJpbmFyeShuZXcgQnVmZmVyKGpzb24uYmFzZTY0LCAnYmFzZTY0JykpO1xuICB9LFxuXG4gIGlzVmFsaWRKU09OKHZhbHVlKSB7XG4gICAgcmV0dXJuIChcbiAgICAgIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgdmFsdWUgIT09IG51bGwgJiYgdmFsdWUuX190eXBlID09PSAnQnl0ZXMnXG4gICAgKTtcbiAgfSxcbn07XG5cbnZhciBHZW9Qb2ludENvZGVyID0ge1xuICBkYXRhYmFzZVRvSlNPTihvYmplY3QpIHtcbiAgICByZXR1cm4ge1xuICAgICAgX190eXBlOiAnR2VvUG9pbnQnLFxuICAgICAgbGF0aXR1ZGU6IG9iamVjdFsxXSxcbiAgICAgIGxvbmdpdHVkZTogb2JqZWN0WzBdLFxuICAgIH07XG4gIH0sXG5cbiAgaXNWYWxpZERhdGFiYXNlT2JqZWN0KG9iamVjdCkge1xuICAgIHJldHVybiBvYmplY3QgaW5zdGFuY2VvZiBBcnJheSAmJiBvYmplY3QubGVuZ3RoID09IDI7XG4gIH0sXG5cbiAgSlNPTlRvRGF0YWJhc2UoanNvbikge1xuICAgIHJldHVybiBbanNvbi5sb25naXR1ZGUsIGpzb24ubGF0aXR1ZGVdO1xuICB9LFxuXG4gIGlzVmFsaWRKU09OKHZhbHVlKSB7XG4gICAgcmV0dXJuIChcbiAgICAgIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgdmFsdWUgIT09IG51bGwgJiYgdmFsdWUuX190eXBlID09PSAnR2VvUG9pbnQnXG4gICAgKTtcbiAgfSxcbn07XG5cbnZhciBQb2x5Z29uQ29kZXIgPSB7XG4gIGRhdGFiYXNlVG9KU09OKG9iamVjdCkge1xuICAgIC8vIENvbnZlcnQgbG5nL2xhdCAtPiBsYXQvbG5nXG4gICAgY29uc3QgY29vcmRzID0gb2JqZWN0LmNvb3JkaW5hdGVzWzBdLm1hcChjb29yZCA9PiB7XG4gICAgICByZXR1cm4gW2Nvb3JkWzFdLCBjb29yZFswXV07XG4gICAgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIF9fdHlwZTogJ1BvbHlnb24nLFxuICAgICAgY29vcmRpbmF0ZXM6IGNvb3JkcyxcbiAgICB9O1xuICB9LFxuXG4gIGlzVmFsaWREYXRhYmFzZU9iamVjdChvYmplY3QpIHtcbiAgICBjb25zdCBjb29yZHMgPSBvYmplY3QuY29vcmRpbmF0ZXNbMF07XG4gICAgaWYgKG9iamVjdC50eXBlICE9PSAnUG9seWdvbicgfHwgIShjb29yZHMgaW5zdGFuY2VvZiBBcnJheSkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb29yZHMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IHBvaW50ID0gY29vcmRzW2ldO1xuICAgICAgaWYgKCFHZW9Qb2ludENvZGVyLmlzVmFsaWREYXRhYmFzZU9iamVjdChwb2ludCkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgUGFyc2UuR2VvUG9pbnQuX3ZhbGlkYXRlKHBhcnNlRmxvYXQocG9pbnRbMV0pLCBwYXJzZUZsb2F0KHBvaW50WzBdKSk7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuICB9LFxuXG4gIEpTT05Ub0RhdGFiYXNlKGpzb24pIHtcbiAgICBsZXQgY29vcmRzID0ganNvbi5jb29yZGluYXRlcztcbiAgICAvLyBBZGQgZmlyc3QgcG9pbnQgdG8gdGhlIGVuZCB0byBjbG9zZSBwb2x5Z29uXG4gICAgaWYgKFxuICAgICAgY29vcmRzWzBdWzBdICE9PSBjb29yZHNbY29vcmRzLmxlbmd0aCAtIDFdWzBdIHx8XG4gICAgICBjb29yZHNbMF1bMV0gIT09IGNvb3Jkc1tjb29yZHMubGVuZ3RoIC0gMV1bMV1cbiAgICApIHtcbiAgICAgIGNvb3Jkcy5wdXNoKGNvb3Jkc1swXSk7XG4gICAgfVxuICAgIGNvbnN0IHVuaXF1ZSA9IGNvb3Jkcy5maWx0ZXIoKGl0ZW0sIGluZGV4LCBhcikgPT4ge1xuICAgICAgbGV0IGZvdW5kSW5kZXggPSAtMTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYXIubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgY29uc3QgcHQgPSBhcltpXTtcbiAgICAgICAgaWYgKHB0WzBdID09PSBpdGVtWzBdICYmIHB0WzFdID09PSBpdGVtWzFdKSB7XG4gICAgICAgICAgZm91bmRJbmRleCA9IGk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiBmb3VuZEluZGV4ID09PSBpbmRleDtcbiAgICB9KTtcbiAgICBpZiAodW5pcXVlLmxlbmd0aCA8IDMpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuSU5URVJOQUxfU0VSVkVSX0VSUk9SLFxuICAgICAgICAnR2VvSlNPTjogTG9vcCBtdXN0IGhhdmUgYXQgbGVhc3QgMyBkaWZmZXJlbnQgdmVydGljZXMnXG4gICAgICApO1xuICAgIH1cbiAgICAvLyBDb252ZXJ0IGxhdC9sb25nIC0+IGxvbmcvbGF0XG4gICAgY29vcmRzID0gY29vcmRzLm1hcChjb29yZCA9PiB7XG4gICAgICByZXR1cm4gW2Nvb3JkWzFdLCBjb29yZFswXV07XG4gICAgfSk7XG4gICAgcmV0dXJuIHsgdHlwZTogJ1BvbHlnb24nLCBjb29yZGluYXRlczogW2Nvb3Jkc10gfTtcbiAgfSxcblxuICBpc1ZhbGlkSlNPTih2YWx1ZSkge1xuICAgIHJldHVybiAoXG4gICAgICB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICE9PSBudWxsICYmIHZhbHVlLl9fdHlwZSA9PT0gJ1BvbHlnb24nXG4gICAgKTtcbiAgfSxcbn07XG5cbnZhciBGaWxlQ29kZXIgPSB7XG4gIGRhdGFiYXNlVG9KU09OKG9iamVjdCkge1xuICAgIHJldHVybiB7XG4gICAgICBfX3R5cGU6ICdGaWxlJyxcbiAgICAgIG5hbWU6IG9iamVjdCxcbiAgICB9O1xuICB9LFxuXG4gIGlzVmFsaWREYXRhYmFzZU9iamVjdChvYmplY3QpIHtcbiAgICByZXR1cm4gdHlwZW9mIG9iamVjdCA9PT0gJ3N0cmluZyc7XG4gIH0sXG5cbiAgSlNPTlRvRGF0YWJhc2UoanNvbikge1xuICAgIHJldHVybiBqc29uLm5hbWU7XG4gIH0sXG5cbiAgaXNWYWxpZEpTT04odmFsdWUpIHtcbiAgICByZXR1cm4gKFxuICAgICAgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB2YWx1ZSAhPT0gbnVsbCAmJiB2YWx1ZS5fX3R5cGUgPT09ICdGaWxlJ1xuICAgICk7XG4gIH0sXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgdHJhbnNmb3JtS2V5LFxuICBwYXJzZU9iamVjdFRvTW9uZ29PYmplY3RGb3JDcmVhdGUsXG4gIHRyYW5zZm9ybVVwZGF0ZSxcbiAgdHJhbnNmb3JtV2hlcmUsXG4gIG1vbmdvT2JqZWN0VG9QYXJzZU9iamVjdCxcbiAgcmVsYXRpdmVUaW1lVG9EYXRlLFxuICB0cmFuc2Zvcm1Db25zdHJhaW50LFxuICB0cmFuc2Zvcm1Qb2ludGVyU3RyaW5nLFxufTtcbiJdfQ==