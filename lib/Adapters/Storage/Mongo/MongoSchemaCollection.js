"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _MongoCollection = _interopRequireDefault(require("./MongoCollection"));

var _node = _interopRequireDefault(require("parse/node"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; var ownKeys = Object.keys(source); if (typeof Object.getOwnPropertySymbols === 'function') { ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function (sym) { return Object.getOwnPropertyDescriptor(source, sym).enumerable; })); } ownKeys.forEach(function (key) { _defineProperty(target, key, source[key]); }); } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

function mongoFieldToParseSchemaField(type) {
  if (type[0] === '*') {
    return {
      type: 'Pointer',
      targetClass: type.slice(1)
    };
  }

  if (type.startsWith('relation<')) {
    return {
      type: 'Relation',
      targetClass: type.slice('relation<'.length, type.length - 1)
    };
  }

  switch (type) {
    case 'number':
      return {
        type: 'Number'
      };

    case 'string':
      return {
        type: 'String'
      };

    case 'boolean':
      return {
        type: 'Boolean'
      };

    case 'date':
      return {
        type: 'Date'
      };

    case 'map':
    case 'object':
      return {
        type: 'Object'
      };

    case 'array':
      return {
        type: 'Array'
      };

    case 'geopoint':
      return {
        type: 'GeoPoint'
      };

    case 'file':
      return {
        type: 'File'
      };

    case 'bytes':
      return {
        type: 'Bytes'
      };

    case 'polygon':
      return {
        type: 'Polygon'
      };
  }
}

const nonFieldSchemaKeys = ['_id', '_metadata', '_client_permissions'];

function mongoSchemaFieldsToParseSchemaFields(schema) {
  var fieldNames = Object.keys(schema).filter(key => nonFieldSchemaKeys.indexOf(key) === -1);
  var response = fieldNames.reduce((obj, fieldName) => {
    obj[fieldName] = mongoFieldToParseSchemaField(schema[fieldName]);
    return obj;
  }, {});
  response.ACL = {
    type: 'ACL'
  };
  response.createdAt = {
    type: 'Date'
  };
  response.updatedAt = {
    type: 'Date'
  };
  response.objectId = {
    type: 'String'
  };
  return response;
}

const emptyCLPS = Object.freeze({
  find: {},
  get: {},
  create: {},
  update: {},
  delete: {},
  addField: {},
  protectedFields: {}
});
const defaultCLPS = Object.freeze({
  find: {
    '*': true
  },
  get: {
    '*': true
  },
  create: {
    '*': true
  },
  update: {
    '*': true
  },
  delete: {
    '*': true
  },
  addField: {
    '*': true
  },
  protectedFields: {
    '*': []
  }
});

function mongoSchemaToParseSchema(mongoSchema) {
  let clps = defaultCLPS;
  let indexes = {};

  if (mongoSchema._metadata) {
    if (mongoSchema._metadata.class_permissions) {
      clps = _objectSpread({}, emptyCLPS, mongoSchema._metadata.class_permissions);
    }

    if (mongoSchema._metadata.indexes) {
      indexes = _objectSpread({}, mongoSchema._metadata.indexes);
    }
  }

  return {
    className: mongoSchema._id,
    fields: mongoSchemaFieldsToParseSchemaFields(mongoSchema),
    classLevelPermissions: clps,
    indexes: indexes
  };
}

function _mongoSchemaQueryFromNameQuery(name, query) {
  const object = {
    _id: name
  };

  if (query) {
    Object.keys(query).forEach(key => {
      object[key] = query[key];
    });
  }

  return object;
} // Returns a type suitable for inserting into mongo _SCHEMA collection.
// Does no validation. That is expected to be done in Parse Server.


function parseFieldTypeToMongoFieldType({
  type,
  targetClass
}) {
  switch (type) {
    case 'Pointer':
      return `*${targetClass}`;

    case 'Relation':
      return `relation<${targetClass}>`;

    case 'Number':
      return 'number';

    case 'String':
      return 'string';

    case 'Boolean':
      return 'boolean';

    case 'Date':
      return 'date';

    case 'Object':
      return 'object';

    case 'Array':
      return 'array';

    case 'GeoPoint':
      return 'geopoint';

    case 'File':
      return 'file';

    case 'Bytes':
      return 'bytes';

    case 'Polygon':
      return 'polygon';
  }
}

class MongoSchemaCollection {
  constructor(collection) {
    this._collection = collection;
  }

  _fetchAllSchemasFrom_SCHEMA() {
    return this._collection._rawFind({}).then(schemas => schemas.map(mongoSchemaToParseSchema));
  }

  _fetchOneSchemaFrom_SCHEMA(name) {
    return this._collection._rawFind(_mongoSchemaQueryFromNameQuery(name), {
      limit: 1
    }).then(results => {
      if (results.length === 1) {
        return mongoSchemaToParseSchema(results[0]);
      } else {
        throw undefined;
      }
    });
  } // Atomically find and delete an object based on query.


  findAndDeleteSchema(name) {
    return this._collection._mongoCollection.findAndRemove(_mongoSchemaQueryFromNameQuery(name), []);
  }

  insertSchema(schema) {
    return this._collection.insertOne(schema).then(result => mongoSchemaToParseSchema(result.ops[0])).catch(error => {
      if (error.code === 11000) {
        //Mongo's duplicate key error
        throw new _node.default.Error(_node.default.Error.DUPLICATE_VALUE, 'Class already exists.');
      } else {
        throw error;
      }
    });
  }

  updateSchema(name, update) {
    return this._collection.updateOne(_mongoSchemaQueryFromNameQuery(name), update);
  }

  upsertSchema(name, query, update) {
    return this._collection.upsertOne(_mongoSchemaQueryFromNameQuery(name, query), update);
  } // Add a field to the schema. If database does not support the field
  // type (e.g. mongo doesn't support more than one GeoPoint in a class) reject with an "Incorrect Type"
  // Parse error with a desciptive message. If the field already exists, this function must
  // not modify the schema, and must reject with DUPLICATE_VALUE error.
  // If this is called for a class that doesn't exist, this function must create that class.
  // TODO: throw an error if an unsupported field type is passed. Deciding whether a type is supported
  // should be the job of the adapter. Some adapters may not support GeoPoint at all. Others may
  // Support additional types that Mongo doesn't, like Money, or something.
  // TODO: don't spend an extra query on finding the schema if the type we are trying to add isn't a GeoPoint.


  addFieldIfNotExists(className, fieldName, type) {
    return this._fetchOneSchemaFrom_SCHEMA(className).then(schema => {
      // If a field with this name already exists, it will be handled elsewhere.
      if (schema.fields[fieldName] != undefined) {
        return;
      } // The schema exists. Check for existing GeoPoints.


      if (type.type === 'GeoPoint') {
        // Make sure there are not other geopoint fields
        if (Object.keys(schema.fields).some(existingField => schema.fields[existingField].type === 'GeoPoint')) {
          throw new _node.default.Error(_node.default.Error.INCORRECT_TYPE, 'MongoDB only supports one GeoPoint field in a class.');
        }
      }

      return;
    }, error => {
      // If error is undefined, the schema doesn't exist, and we can create the schema with the field.
      // If some other error, reject with it.
      if (error === undefined) {
        return;
      }

      throw error;
    }).then(() => {
      // We use $exists and $set to avoid overwriting the field type if it
      // already exists. (it could have added inbetween the last query and the update)
      return this.upsertSchema(className, {
        [fieldName]: {
          $exists: false
        }
      }, {
        $set: {
          [fieldName]: parseFieldTypeToMongoFieldType(type)
        }
      });
    });
  }

} // Exported for testing reasons and because we haven't moved all mongo schema format
// related logic into the database adapter yet.


MongoSchemaCollection._TESTmongoSchemaToParseSchema = mongoSchemaToParseSchema;
MongoSchemaCollection.parseFieldTypeToMongoFieldType = parseFieldTypeToMongoFieldType;
var _default = MongoSchemaCollection;
exports.default = _default;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9BZGFwdGVycy9TdG9yYWdlL01vbmdvL01vbmdvU2NoZW1hQ29sbGVjdGlvbi5qcyJdLCJuYW1lcyI6WyJtb25nb0ZpZWxkVG9QYXJzZVNjaGVtYUZpZWxkIiwidHlwZSIsInRhcmdldENsYXNzIiwic2xpY2UiLCJzdGFydHNXaXRoIiwibGVuZ3RoIiwibm9uRmllbGRTY2hlbWFLZXlzIiwibW9uZ29TY2hlbWFGaWVsZHNUb1BhcnNlU2NoZW1hRmllbGRzIiwic2NoZW1hIiwiZmllbGROYW1lcyIsIk9iamVjdCIsImtleXMiLCJmaWx0ZXIiLCJrZXkiLCJpbmRleE9mIiwicmVzcG9uc2UiLCJyZWR1Y2UiLCJvYmoiLCJmaWVsZE5hbWUiLCJBQ0wiLCJjcmVhdGVkQXQiLCJ1cGRhdGVkQXQiLCJvYmplY3RJZCIsImVtcHR5Q0xQUyIsImZyZWV6ZSIsImZpbmQiLCJnZXQiLCJjcmVhdGUiLCJ1cGRhdGUiLCJkZWxldGUiLCJhZGRGaWVsZCIsInByb3RlY3RlZEZpZWxkcyIsImRlZmF1bHRDTFBTIiwibW9uZ29TY2hlbWFUb1BhcnNlU2NoZW1hIiwibW9uZ29TY2hlbWEiLCJjbHBzIiwiaW5kZXhlcyIsIl9tZXRhZGF0YSIsImNsYXNzX3Blcm1pc3Npb25zIiwiY2xhc3NOYW1lIiwiX2lkIiwiZmllbGRzIiwiY2xhc3NMZXZlbFBlcm1pc3Npb25zIiwiX21vbmdvU2NoZW1hUXVlcnlGcm9tTmFtZVF1ZXJ5IiwibmFtZSIsInF1ZXJ5Iiwib2JqZWN0IiwiZm9yRWFjaCIsInBhcnNlRmllbGRUeXBlVG9Nb25nb0ZpZWxkVHlwZSIsIk1vbmdvU2NoZW1hQ29sbGVjdGlvbiIsImNvbnN0cnVjdG9yIiwiY29sbGVjdGlvbiIsIl9jb2xsZWN0aW9uIiwiX2ZldGNoQWxsU2NoZW1hc0Zyb21fU0NIRU1BIiwiX3Jhd0ZpbmQiLCJ0aGVuIiwic2NoZW1hcyIsIm1hcCIsIl9mZXRjaE9uZVNjaGVtYUZyb21fU0NIRU1BIiwibGltaXQiLCJyZXN1bHRzIiwidW5kZWZpbmVkIiwiZmluZEFuZERlbGV0ZVNjaGVtYSIsIl9tb25nb0NvbGxlY3Rpb24iLCJmaW5kQW5kUmVtb3ZlIiwiaW5zZXJ0U2NoZW1hIiwiaW5zZXJ0T25lIiwicmVzdWx0Iiwib3BzIiwiY2F0Y2giLCJlcnJvciIsImNvZGUiLCJQYXJzZSIsIkVycm9yIiwiRFVQTElDQVRFX1ZBTFVFIiwidXBkYXRlU2NoZW1hIiwidXBkYXRlT25lIiwidXBzZXJ0U2NoZW1hIiwidXBzZXJ0T25lIiwiYWRkRmllbGRJZk5vdEV4aXN0cyIsInNvbWUiLCJleGlzdGluZ0ZpZWxkIiwiSU5DT1JSRUNUX1RZUEUiLCIkZXhpc3RzIiwiJHNldCIsIl9URVNUbW9uZ29TY2hlbWFUb1BhcnNlU2NoZW1hIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQUE7O0FBQ0E7Ozs7Ozs7O0FBRUEsU0FBU0EsNEJBQVQsQ0FBc0NDLElBQXRDLEVBQTRDO0FBQzFDLE1BQUlBLElBQUksQ0FBQyxDQUFELENBQUosS0FBWSxHQUFoQixFQUFxQjtBQUNuQixXQUFPO0FBQ0xBLE1BQUFBLElBQUksRUFBRSxTQUREO0FBRUxDLE1BQUFBLFdBQVcsRUFBRUQsSUFBSSxDQUFDRSxLQUFMLENBQVcsQ0FBWDtBQUZSLEtBQVA7QUFJRDs7QUFDRCxNQUFJRixJQUFJLENBQUNHLFVBQUwsQ0FBZ0IsV0FBaEIsQ0FBSixFQUFrQztBQUNoQyxXQUFPO0FBQ0xILE1BQUFBLElBQUksRUFBRSxVQUREO0FBRUxDLE1BQUFBLFdBQVcsRUFBRUQsSUFBSSxDQUFDRSxLQUFMLENBQVcsWUFBWUUsTUFBdkIsRUFBK0JKLElBQUksQ0FBQ0ksTUFBTCxHQUFjLENBQTdDO0FBRlIsS0FBUDtBQUlEOztBQUNELFVBQVFKLElBQVI7QUFDRSxTQUFLLFFBQUw7QUFDRSxhQUFPO0FBQUVBLFFBQUFBLElBQUksRUFBRTtBQUFSLE9BQVA7O0FBQ0YsU0FBSyxRQUFMO0FBQ0UsYUFBTztBQUFFQSxRQUFBQSxJQUFJLEVBQUU7QUFBUixPQUFQOztBQUNGLFNBQUss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Qiw4QkFBOEIsQ0FBQy9DLElBQUQ7QUFBN0M7QUFBUixPQUhLLENBQVA7QUFLRCxLQXpDSSxDQUFQO0FBMENEOztBQXRIeUIsQyxDQXlINUI7QUFDQTs7O0FBQ0FnRCxxQkFBcUIsQ0FBQ29DLDZCQUF0QixHQUFzRHBELHdCQUF0RDtBQUNBZ0IscUJBQXFCLENBQUNELDhCQUF0QixHQUF1REEsOEJBQXZEO2VBRWVDLHFCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IE1vbmdvQ29sbGVjdGlvbiBmcm9tICcuL01vbmdvQ29sbGVjdGlvbic7XG5pbXBvcnQgUGFyc2UgZnJvbSAncGFyc2Uvbm9kZSc7XG5cbmZ1bmN0aW9uIG1vbmdvRmllbGRUb1BhcnNlU2NoZW1hRmllbGQodHlwZSkge1xuICBpZiAodHlwZVswXSA9PT0gJyonKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHR5cGU6ICdQb2ludGVyJyxcbiAgICAgIHRhcmdldENsYXNzOiB0eXBlLnNsaWNlKDEpLFxuICAgIH07XG4gIH1cbiAgaWYgKHR5cGUuc3RhcnRzV2l0aCgncmVsYXRpb248JykpIHtcbiAgICByZXR1cm4ge1xuICAgICAgdHlwZTogJ1JlbGF0aW9uJyxcbiAgICAgIHRhcmdldENsYXNzOiB0eXBlLnNsaWNlKCdyZWxhdGlvbjwnLmxlbmd0aCwgdHlwZS5sZW5ndGggLSAxKSxcbiAgICB9O1xuICB9XG4gIHN3aXRjaCAodHlwZSkge1xuICAgIGNhc2UgJ251bWJlcic6XG4gICAgICByZXR1cm4geyB0eXBlOiAnTnVtYmVyJyB9O1xuICAgIGNhc2UgJ3N0cmluZyc6XG4gICAgICByZXR1cm4geyB0eXBlOiAnU3RyaW5nJyB9O1xuICAgIGNhc2UgJ2Jvb2xlYW4nOlxuICAgICAgcmV0dXJuIHsgdHlwZTogJ0Jvb2xlYW4nIH07XG4gICAgY2FzZSAnZGF0ZSc6XG4gICAgICByZXR1cm4geyB0eXBlOiAnRGF0ZScgfTtcbiAgICBjYXNlICdtYXAnOlxuICAgIGNhc2UgJ29iamVjdCc6XG4gICAgICByZXR1cm4geyB0eXBlOiAnT2JqZWN0JyB9O1xuICAgIGNhc2UgJ2FycmF5JzpcbiAgICAgIHJldHVybiB7IHR5cGU6ICdBcnJheScgfTtcbiAgICBjYXNlICdnZW9wb2ludCc6XG4gICAgICByZXR1cm4geyB0eXBlOiAnR2VvUG9pbnQnIH07XG4gICAgY2FzZSAnZmlsZSc6XG4gICAgICByZXR1cm4geyB0eXBlOiAnRmlsZScgfTtcbiAgICBjYXNlICdieXRlcyc6XG4gICAgICByZXR1cm4geyB0eXBlOiAnQnl0ZXMnIH07XG4gICAgY2FzZSAncG9seWdvbic6XG4gICAgICByZXR1cm4geyB0eXBlOiAnUG9seWdvbicgfTtcbiAgfVxufVxuXG5jb25zdCBub25GaWVsZFNjaGVtYUtleXMgPSBbJ19pZCcsICdfbWV0YWRhdGEnLCAnX2NsaWVudF9wZXJtaXNzaW9ucyddO1xuZnVuY3Rpb24gbW9uZ29TY2hlbWFGaWVsZHNUb1BhcnNlU2NoZW1hRmllbGRzKHNjaGVtYSkge1xuICB2YXIgZmllbGROYW1lcyA9IE9iamVjdC5rZXlzKHNjaGVtYSkuZmlsdGVyKFxuICAgIGtleSA9PiBub25GaWVsZFNjaGVtYUtleXMuaW5kZXhPZihrZXkpID09PSAtMVxuICApO1xuICB2YXIgcmVzcG9uc2UgPSBmaWVsZE5hbWVzLnJlZHVjZSgob2JqLCBmaWVsZE5hbWUpID0+IHtcbiAgICBvYmpbZmllbGROYW1lXSA9IG1vbmdvRmllbGRUb1BhcnNlU2NoZW1hRmllbGQoc2NoZW1hW2ZpZWxkTmFtZV0pO1xuICAgIHJldHVybiBvYmo7XG4gIH0sIHt9KTtcbiAgcmVzcG9uc2UuQUNMID0geyB0eXBlOiAnQUNMJyB9O1xuICByZXNwb25zZS5jcmVhdGVkQXQgPSB7IHR5cGU6ICdEYXRlJyB9O1xuICByZXNwb25zZS51cGRhdGVkQXQgPSB7IHR5cGU6ICdEYXRlJyB9O1xuICByZXNwb25zZS5vYmplY3RJZCA9IHsgdHlwZTogJ1N0cmluZycgfTtcbiAgcmV0dXJuIHJlc3BvbnNlO1xufVxuXG5jb25zdCBlbXB0eUNMUFMgPSBPYmplY3QuZnJlZXplKHtcbiAgZmluZDoge30sXG4gIGdldDoge30sXG4gIGNyZWF0ZToge30sXG4gIHVwZGF0ZToge30sXG4gIGRlbGV0ZToge30sXG4gIGFkZEZpZWxkOiB7fSxcbiAgcHJvdGVjdGVkRmllbGRzOiB7fSxcbn0pO1xuXG5jb25zdCBkZWZhdWx0Q0xQUyA9IE9iamVjdC5mcmVlemUoe1xuICBmaW5kOiB7ICcqJzogdHJ1ZSB9LFxuICBnZXQ6IHsgJyonOiB0cnVlIH0sXG4gIGNyZWF0ZTogeyAnKic6IHRydWUgfSxcbiAgdXBkYXRlOiB7ICcqJzogdHJ1ZSB9LFxuICBkZWxldGU6IHsgJyonOiB0cnVlIH0sXG4gIGFkZEZpZWxkOiB7ICcqJzogdHJ1ZSB9LFxuICBwcm90ZWN0ZWRGaWVsZHM6IHsgJyonOiBbXSB9LFxufSk7XG5cbmZ1bmN0aW9uIG1vbmdvU2NoZW1hVG9QYXJzZVNjaGVtYShtb25nb1NjaGVtYSkge1xuICBsZXQgY2xwcyA9IGRlZmF1bHRDTFBTO1xuICBsZXQgaW5kZXhlcyA9IHt9O1xuICBpZiAobW9uZ29TY2hlbWEuX21ldGFkYXRhKSB7XG4gICAgaWYgKG1vbmdvU2NoZW1hLl9tZXRhZGF0YS5jbGFzc19wZXJtaXNzaW9ucykge1xuICAgICAgY2xwcyA9IHsgLi4uZW1wdHlDTFBTLCAuLi5tb25nb1NjaGVtYS5fbWV0YWRhdGEuY2xhc3NfcGVybWlzc2lvbnMgfTtcbiAgICB9XG4gICAgaWYgKG1vbmdvU2NoZW1hLl9tZXRhZGF0YS5pbmRleGVzKSB7XG4gICAgICBpbmRleGVzID0geyAuLi5tb25nb1NjaGVtYS5fbWV0YWRhdGEuaW5kZXhlcyB9O1xuICAgIH1cbiAgfVxuICByZXR1cm4ge1xuICAgIGNsYXNzTmFtZTogbW9uZ29TY2hlbWEuX2lkLFxuICAgIGZpZWxkczogbW9uZ29TY2hlbWFGaWVsZHNUb1BhcnNlU2NoZW1hRmllbGRzKG1vbmdvU2NoZW1hKSxcbiAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IGNscHMsXG4gICAgaW5kZXhlczogaW5kZXhlcyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gX21vbmdvU2NoZW1hUXVlcnlGcm9tTmFtZVF1ZXJ5KG5hbWU6IHN0cmluZywgcXVlcnkpIHtcbiAgY29uc3Qgb2JqZWN0ID0geyBfaWQ6IG5hbWUgfTtcbiAgaWYgKHF1ZXJ5KSB7XG4gICAgT2JqZWN0LmtleXMocXVlcnkpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgIG9iamVjdFtrZXldID0gcXVlcnlba2V5XTtcbiAgICB9KTtcbiAgfVxuICByZXR1cm4gb2JqZWN0O1xufVxuXG4vLyBSZXR1cm5zIGEgdHlwZSBzdWl0YWJsZSBmb3IgaW5zZXJ0aW5nIGludG8gbW9uZ28gX1NDSEVNQSBjb2xsZWN0aW9uLlxuLy8gRG9lcyBubyB2YWxpZGF0aW9uLiBUaGF0IGlzIGV4cGVjdGVkIHRvIGJlIGRvbmUgaW4gUGFyc2UgU2VydmVyLlxuZnVuY3Rpb24gcGFyc2VGaWVsZFR5cGVUb01vbmdvRmllbGRUeXBlKHsgdHlwZSwgdGFyZ2V0Q2xhc3MgfSkge1xuICBzd2l0Y2ggKHR5cGUpIHtcbiAgICBjYXNlICdQb2ludGVyJzpcbiAgICAgIHJldHVybiBgKiR7dGFyZ2V0Q2xhc3N9YDtcbiAgICBjYXNlICdSZWxhdGlvbic6XG4gICAgICByZXR1cm4gYHJlbGF0aW9uPCR7dGFyZ2V0Q2xhc3N9PmA7XG4gICAgY2FzZSAnTnVtYmVyJzpcbiAgICAgIHJldHVybiAnbnVtYmVyJztcbiAgICBjYXNlICdTdHJpbmcnOlxuICAgICAgcmV0dXJuICdzdHJpbmcnO1xuICAgIGNhc2UgJ0Jvb2xlYW4nOlxuICAgICAgcmV0dXJuICdib29sZWFuJztcbiAgICBjYXNlICdEYXRlJzpcbiAgICAgIHJldHVybiAnZGF0ZSc7XG4gICAgY2FzZSAnT2JqZWN0JzpcbiAgICAgIHJldHVybiAnb2JqZWN0JztcbiAgICBjYXNlICdBcnJheSc6XG4gICAgICByZXR1cm4gJ2FycmF5JztcbiAgICBjYXNlICdHZW9Qb2ludCc6XG4gICAgICByZXR1cm4gJ2dlb3BvaW50JztcbiAgICBjYXNlICdGaWxlJzpcbiAgICAgIHJldHVybiAnZmlsZSc7XG4gICAgY2FzZSAnQnl0ZXMnOlxuICAgICAgcmV0dXJuICdieXRlcyc7XG4gICAgY2FzZSAnUG9seWdvbic6XG4gICAgICByZXR1cm4gJ3BvbHlnb24nO1xuICB9XG59XG5cbmNsYXNzIE1vbmdvU2NoZW1hQ29sbGVjdGlvbiB7XG4gIF9jb2xsZWN0aW9uOiBNb25nb0NvbGxlY3Rpb247XG5cbiAgY29uc3RydWN0b3IoY29sbGVjdGlvbjogTW9uZ29Db2xsZWN0aW9uKSB7XG4gICAgdGhpcy5fY29sbGVjdGlvbiA9IGNvbGxlY3Rpb247XG4gIH1cblxuICBfZmV0Y2hBbGxTY2hlbWFzRnJvbV9TQ0hFTUEoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2NvbGxlY3Rpb25cbiAgICAgIC5fcmF3RmluZCh7fSlcbiAgICAgIC50aGVuKHNjaGVtYXMgPT4gc2NoZW1hcy5tYXAobW9uZ29TY2hlbWFUb1BhcnNlU2NoZW1hKSk7XG4gIH1cblxuICBfZmV0Y2hPbmVTY2hlbWFGcm9tX1NDSEVNQShuYW1lOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5fY29sbGVjdGlvblxuICAgICAgLl9yYXdGaW5kKF9tb25nb1NjaGVtYVF1ZXJ5RnJvbU5hbWVRdWVyeShuYW1lKSwgeyBsaW1pdDogMSB9KVxuICAgICAgLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICAgIGlmIChyZXN1bHRzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAgIHJldHVybiBtb25nb1NjaGVtYVRvUGFyc2VTY2hlbWEocmVzdWx0c1swXSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgfVxuXG4gIC8vIEF0b21pY2FsbHkgZmluZCBhbmQgZGVsZXRlIGFuIG9iamVjdCBiYXNlZCBvbiBxdWVyeS5cbiAgZmluZEFuZERlbGV0ZVNjaGVtYShuYW1lOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5fY29sbGVjdGlvbi5fbW9uZ29Db2xsZWN0aW9uLmZpbmRBbmRSZW1vdmUoXG4gICAgICBfbW9uZ29TY2hlbWFRdWVyeUZyb21OYW1lUXVlcnkobmFtZSksXG4gICAgICBbXVxuICAgICk7XG4gIH1cblxuICBpbnNlcnRTY2hlbWEoc2NoZW1hOiBhbnkpIHtcbiAgICByZXR1cm4gdGhpcy5fY29sbGVjdGlvblxuICAgICAgLmluc2VydE9uZShzY2hlbWEpXG4gICAgICAudGhlbihyZXN1bHQgPT4gbW9uZ29TY2hlbWFUb1BhcnNlU2NoZW1hKHJlc3VsdC5vcHNbMF0pKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yLmNvZGUgPT09IDExMDAwKSB7XG4gICAgICAgICAgLy9Nb25nbydzIGR1cGxpY2F0ZSBrZXkgZXJyb3JcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUsXG4gICAgICAgICAgICAnQ2xhc3MgYWxyZWFkeSBleGlzdHMuJ1xuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9XG5cbiAgdXBkYXRlU2NoZW1hKG5hbWU6IHN0cmluZywgdXBkYXRlKSB7XG4gICAgcmV0dXJuIHRoaXMuX2NvbGxlY3Rpb24udXBkYXRlT25lKFxuICAgICAgX21vbmdvU2NoZW1hUXVlcnlGcm9tTmFtZVF1ZXJ5KG5hbWUpLFxuICAgICAgdXBkYXRlXG4gICAgKTtcbiAgfVxuXG4gIHVwc2VydFNjaGVtYShuYW1lOiBzdHJpbmcsIHF1ZXJ5OiBzdHJpbmcsIHVwZGF0ZSkge1xuICAgIHJldHVybiB0aGlzLl9jb2xsZWN0aW9uLnVwc2VydE9uZShcbiAgICAgIF9tb25nb1NjaGVtYVF1ZXJ5RnJvbU5hbWVRdWVyeShuYW1lLCBxdWVyeSksXG4gICAgICB1cGRhdGVcbiAgICApO1xuICB9XG5cbiAgLy8gQWRkIGEgZmllbGQgdG8gdGhlIHNjaGVtYS4gSWYgZGF0YWJhc2UgZG9lcyBub3Qgc3VwcG9ydCB0aGUgZmllbGRcbiAgLy8gdHlwZSAoZS5nLiBtb25nbyBkb2Vzbid0IHN1cHBvcnQgbW9yZSB0aGFuIG9uZSBHZW9Qb2ludCBpbiBhIGNsYXNzKSByZWplY3Qgd2l0aCBhbiBcIkluY29ycmVjdCBUeXBlXCJcbiAgLy8gUGFyc2UgZXJyb3Igd2l0aCBhIGRlc2NpcHRpdmUgbWVzc2FnZS4gSWYgdGhlIGZpZWxkIGFscmVhZHkgZXhpc3RzLCB0aGlzIGZ1bmN0aW9uIG11c3RcbiAgLy8gbm90IG1vZGlmeSB0aGUgc2NoZW1hLCBhbmQgbXVzdCByZWplY3Qgd2l0aCBEVVBMSUNBVEVfVkFMVUUgZXJyb3IuXG4gIC8vIElmIHRoaXMgaXMgY2FsbGVkIGZvciBhIGNsYXNzIHRoYXQgZG9lc24ndCBleGlzdCwgdGhpcyBmdW5jdGlvbiBtdXN0IGNyZWF0ZSB0aGF0IGNsYXNzLlxuXG4gIC8vIFRPRE86IHRocm93IGFuIGVycm9yIGlmIGFuIHVuc3VwcG9ydGVkIGZpZWxkIHR5cGUgaXMgcGFzc2VkLiBEZWNpZGluZyB3aGV0aGVyIGEgdHlwZSBpcyBzdXBwb3J0ZWRcbiAgLy8gc2hvdWxkIGJlIHRoZSBqb2Igb2YgdGhlIGFkYXB0ZXIuIFNvbWUgYWRhcHRlcnMgbWF5IG5vdCBzdXBwb3J0IEdlb1BvaW50IGF0IGFsbC4gT3RoZXJzIG1heVxuICAvLyBTdXBwb3J0IGFkZGl0aW9uYWwgdHlwZXMgdGhhdCBNb25nbyBkb2Vzbid0LCBsaWtlIE1vbmV5LCBvciBzb21ldGhpbmcuXG5cbiAgLy8gVE9ETzogZG9uJ3Qgc3BlbmQgYW4gZXh0cmEgcXVlcnkgb24gZmluZGluZyB0aGUgc2NoZW1hIGlmIHRoZSB0eXBlIHdlIGFyZSB0cnlpbmcgdG8gYWRkIGlzbid0IGEgR2VvUG9pbnQuXG4gIGFkZEZpZWxkSWZOb3RFeGlzdHMoY2xhc3NOYW1lOiBzdHJpbmcsIGZpZWxkTmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5fZmV0Y2hPbmVTY2hlbWFGcm9tX1NDSEVNQShjbGFzc05hbWUpXG4gICAgICAudGhlbihcbiAgICAgICAgc2NoZW1hID0+IHtcbiAgICAgICAgICAvLyBJZiBhIGZpZWxkIHdpdGggdGhpcyBuYW1lIGFscmVhZHkgZXhpc3RzLCBpdCB3aWxsIGJlIGhhbmRsZWQgZWxzZXdoZXJlLlxuICAgICAgICAgIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0gIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIFRoZSBzY2hlbWEgZXhpc3RzLiBDaGVjayBmb3IgZXhpc3RpbmcgR2VvUG9pbnRzLlxuICAgICAgICAgIGlmICh0eXBlLnR5cGUgPT09ICdHZW9Qb2ludCcpIHtcbiAgICAgICAgICAgIC8vIE1ha2Ugc3VyZSB0aGVyZSBhcmUgbm90IG90aGVyIGdlb3BvaW50IGZpZWxkc1xuICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICBPYmplY3Qua2V5cyhzY2hlbWEuZmllbGRzKS5zb21lKFxuICAgICAgICAgICAgICAgIGV4aXN0aW5nRmllbGQgPT5cbiAgICAgICAgICAgICAgICAgIHNjaGVtYS5maWVsZHNbZXhpc3RpbmdGaWVsZF0udHlwZSA9PT0gJ0dlb1BvaW50J1xuICAgICAgICAgICAgICApXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOQ09SUkVDVF9UWVBFLFxuICAgICAgICAgICAgICAgICdNb25nb0RCIG9ubHkgc3VwcG9ydHMgb25lIEdlb1BvaW50IGZpZWxkIGluIGEgY2xhc3MuJ1xuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH0sXG4gICAgICAgIGVycm9yID0+IHtcbiAgICAgICAgICAvLyBJZiBlcnJvciBpcyB1bmRlZmluZWQsIHRoZSBzY2hlbWEgZG9lc24ndCBleGlzdCwgYW5kIHdlIGNhbiBjcmVhdGUgdGhlIHNjaGVtYSB3aXRoIHRoZSBmaWVsZC5cbiAgICAgICAgICAvLyBJZiBzb21lIG90aGVyIGVycm9yLCByZWplY3Qgd2l0aCBpdC5cbiAgICAgICAgICBpZiAoZXJyb3IgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgKVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAvLyBXZSB1c2UgJGV4aXN0cyBhbmQgJHNldCB0byBhdm9pZCBvdmVyd3JpdGluZyB0aGUgZmllbGQgdHlwZSBpZiBpdFxuICAgICAgICAvLyBhbHJlYWR5IGV4aXN0cy4gKGl0IGNvdWxkIGhhdmUgYWRkZWQgaW5iZXR3ZWVuIHRoZSBsYXN0IHF1ZXJ5IGFuZCB0aGUgdXBkYXRlKVxuICAgICAgICByZXR1cm4gdGhpcy51cHNlcnRTY2hlbWEoXG4gICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgIHsgW2ZpZWxkTmFtZV06IHsgJGV4aXN0czogZmFsc2UgfSB9LFxuICAgICAgICAgIHsgJHNldDogeyBbZmllbGROYW1lXTogcGFyc2VGaWVsZFR5cGVUb01vbmdvRmllbGRUeXBlKHR5cGUpIH0gfVxuICAgICAgICApO1xuICAgICAgfSk7XG4gIH1cbn1cblxuLy8gRXhwb3J0ZWQgZm9yIHRlc3RpbmcgcmVhc29ucyBhbmQgYmVjYXVzZSB3ZSBoYXZlbid0IG1vdmVkIGFsbCBtb25nbyBzY2hlbWEgZm9ybWF0XG4vLyByZWxhdGVkIGxvZ2ljIGludG8gdGhlIGRhdGFiYXNlIGFkYXB0ZXIgeWV0LlxuTW9uZ29TY2hlbWFDb2xsZWN0aW9uLl9URVNUbW9uZ29TY2hlbWFUb1BhcnNlU2NoZW1hID0gbW9uZ29TY2hlbWFUb1BhcnNlU2NoZW1hO1xuTW9uZ29TY2hlbWFDb2xsZWN0aW9uLnBhcnNlRmllbGRUeXBlVG9Nb25nb0ZpZWxkVHlwZSA9IHBhcnNlRmllbGRUeXBlVG9Nb25nb0ZpZWxkVHlwZTtcblxuZXhwb3J0IGRlZmF1bHQgTW9uZ29TY2hlbWFDb2xsZWN0aW9uO1xuIl19