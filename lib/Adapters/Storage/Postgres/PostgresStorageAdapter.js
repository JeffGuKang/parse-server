"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.PostgresStorageAdapter = void 0;

var _PostgresClient = require("./PostgresClient");

var _node = _interopRequireDefault(require("parse/node"));

var _lodash = _interopRequireDefault(require("lodash"));

var _sql = _interopRequireDefault(require("./sql"));

var _xregexp = require("xregexp");

var _StorageAdapter = require("../StorageAdapter");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; var ownKeys = Object.keys(source); if (typeof Object.getOwnPropertySymbols === 'function') { ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function (sym) { return Object.getOwnPropertyDescriptor(source, sym).enumerable; })); } ownKeys.forEach(function (key) { _defineProperty(target, key, source[key]); }); } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

const PostgresRelationDoesNotExistError = '42P01';
const PostgresDuplicateRelationError = '42P07';
const PostgresDuplicateColumnError = '42701';
const PostgresMissingColumnError = '42703';
const PostgresDuplicateObjectError = '42710';
const PostgresUniqueIndexViolationError = '23505';
const PostgresTransactionAbortedError = '25P02';

const logger = require('../../../logger');

const debug = function (...args) {
  args = ['PG: ' + arguments[0]].concat(args.slice(1, args.length));
  const log = logger.getLogger();
  log.debug.apply(log, args);
};

const parseTypeToPostgresType = type => {
  switch (type.type) {
    case 'String':
      return 'text';

    case 'Date':
      return 'timestamp with time zone';

    case 'Object':
      return 'jsonb';

    case 'File':
      return 'text';

    case 'Boolean':
      return 'boolean';

    case 'Pointer':
      return 'char(10)';

    case 'Number':
      return 'double precision';

    case 'GeoPoint':
      return 'point';

    case 'Bytes':
      return 'jsonb';

    case 'Polygon':
      return 'polygon';

    case 'Array':
      if (type.contents && type.contents.type === 'String') {
        return 'text[]';
      } else {
        return 'jsonb';
      }

    default:
      throw `no type for ${JSON.stringify(type)} yet`;
  }
};

const ParseToPosgresComparator = {
  $gt: '>',
  $lt: '<',
  $gte: '>=',
  $lte: '<='
};
const mongoAggregateToPostgres = {
  $dayOfMonth: 'DAY',
  $dayOfWeek: 'DOW',
  $dayOfYear: 'DOY',
  $isoDayOfWeek: 'ISODOW',
  $isoWeekYear: 'ISOYEAR',
  $hour: 'HOUR',
  $minute: 'MINUTE',
  $second: 'SECOND',
  $millisecond: 'MILLISECONDS',
  $month: 'MONTH',
  $week: 'WEEK',
  $year: 'YEAR'
};

const toPostgresValue = value => {
  if (typeof value === 'object') {
    if (value.__type === 'Date') {
      return value.iso;
    }

    if (value.__type === 'File') {
      return value.name;
    }
  }

  return value;
};

const transformValue = value => {
  if (typeof value === 'object' && value.__type === 'Pointer') {
    return value.objectId;
  }

  return value;
}; // Duplicate from then mongo adapter...


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

const toParseSchema = schema => {
  if (schema.className === '_User') {
    delete schema.fields._hashed_password;
  }

  if (schema.fields) {
    delete schema.fields._wperm;
    delete schema.fields._rperm;
  }

  let clps = defaultCLPS;

  if (schema.classLevelPermissions) {
    clps = _objectSpread({}, emptyCLPS, schema.classLevelPermissions);
  }

  let indexes = {};

  if (schema.indexes) {
    indexes = _objectSpread({}, schema.indexes);
  }

  return {
    className: schema.className,
    fields: schema.fields,
    classLevelPermissions: clps,
    indexes
  };
};

const toPostgresSchema = schema => {
  if (!schema) {
    return schema;
  }

  schema.fields = schema.fields || {};
  schema.fields._wperm = {
    type: 'Array',
    contents: {
      type: 'String'
    }
  };
  schema.fields._rperm = {
    type: 'Array',
    contents: {
      type: 'String'
    }
  };

  if (schema.className === '_User') {
    schema.fields._hashed_password = {
      type: 'String'
    };
    schema.fields._password_history = {
      type: 'Array'
    };
  }

  return schema;
};

const handleDotFields = object => {
  Object.keys(object).forEach(fieldName => {
    if (fieldName.indexOf('.') > -1) {
      const components = fieldName.split('.');
      const first = components.shift();
      object[first] = object[first] || {};
      let currentObj = object[first];
      let next;
      let value = object[fieldName];

      if (value && value.__op === 'Delete') {
        value = undefined;
      }
      /* eslint-disable no-cond-assign */


      while (next = components.shift()) {
        /* eslint-enable no-cond-assign */
        currentObj[next] = currentObj[next] || {};

        if (components.length === 0) {
          currentObj[next] = value;
        }

        currentObj = currentObj[next];
      }

      delete object[fieldName];
    }
  });
  return object;
};

const transformDotFieldToComponents = fieldName => {
  return fieldName.split('.').map((cmpt, index) => {
    if (index === 0) {
      return `"${cmpt}"`;
    }

    return `'${cmpt}'`;
  });
};

const transformDotField = fieldName => {
  if (fieldName.indexOf('.') === -1) {
    return `"${fieldName}"`;
  }

  const components = transformDotFieldToComponents(fieldName);
  let name = components.slice(0, components.length - 1).join('->');
  name += '->>' + components[components.length - 1];
  return name;
};

const transformAggregateField = fieldName => {
  if (typeof fieldName !== 'string') {
    return fieldName;
  }

  if (fieldName === '$_created_at') {
    return 'createdAt';
  }

  if (fieldName === '$_updated_at') {
    return 'updatedAt';
  }

  return fieldName.substr(1);
};

const validateKeys = object => {
  if (typeof object == 'object') {
    for (const key in object) {
      if (typeof object[key] == 'object') {
        validateKeys(object[key]);
      }

      if (key.includes('$') || key.includes('.')) {
        throw new _node.default.Error(_node.default.Error.INVALID_NESTED_KEY, "Nested keys should not contain the '$' or '.' characters");
      }
    }
  }
}; // Returns the list of join tables on a schema


const joinTablesForSchema = schema => {
  const list = [];

  if (schema) {
    Object.keys(schema.fields).forEach(field => {
      if (schema.fields[field].type === 'Relation') {
        list.push(`_Join:${field}:${schema.className}`);
      }
    });
  }

  return list;
};

const buildWhereClause = ({
  schema,
  query,
  index
}) => {
  const patterns = [];
  let values = [];
  const sorts = [];
  schema = toPostgresSchema(schema);

  for (const fieldName in query) {
    const isArrayField = schema.fields && schema.fields[fieldName] && schema.fields[fieldName].type === 'Array';
    const initialPatternsLength = patterns.length;
    const fieldValue = query[fieldName]; // nothingin the schema, it's gonna blow up

    if (!schema.fields[fieldName]) {
      // as it won't exist
      if (fieldValue && fieldValue.$exists === false) {
        continue;
      }
    }

    if (fieldName.indexOf('.') >= 0) {
      let name = transformDotField(fieldName);

      if (fieldValue === null) {
        patterns.push(`${name} IS NULL`);
      } else {
        if (fieldValue.$in) {
          const inPatterns = [];
          name = transformDotFieldToComponents(fieldName).join('->');
          fieldValue.$in.forEach(listElem => {
            if (typeof listElem === 'string') {
              if (listElem.includes('"') || listElem.includes("'")) {
                throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $in value; Strings with quotes cannot yet be safely escaped');
              }

              inPatterns.push(`"${listElem}"`);
            } else {
              inPatterns.push(`${listElem}`);
            }
          });
          patterns.push(`(${name})::jsonb @> '[${inPatterns.join()}]'::jsonb`);
        } else if (fieldValue.$regex) {// Handle later
        } else {
          patterns.push(`${name} = '${fieldValue}'`);
        }
      }
    } else if (fieldValue === null || fieldValue === undefined) {
      patterns.push(`$${index}:name IS NULL`);
      values.push(fieldName);
      index += 1;
      continue;
    } else if (typeof fieldValue === 'string') {
      patterns.push(`$${index}:name = $${index + 1}`);
      values.push(fieldName, fieldValue);
      index += 2;
    } else if (typeof fieldValue === 'boolean') {
      patterns.push(`$${index}:name = $${index + 1}`); // Can't cast boolean to double precision

      if (schema.fields[fieldName] && schema.fields[fieldName].type === 'Number') {
        // Should always return zero results
        const MAX_INT_PLUS_ONE = 9223372036854775808;
        values.push(fieldName, MAX_INT_PLUS_ONE);
      } else {
        values.push(fieldName, fieldValue);
      }

      index += 2;
    } else if (typeof fieldValue === 'number') {
      patterns.push(`$${index}:name = $${index + 1}`);
      values.push(fieldName, fieldValue);
      index += 2;
    } else if (['$or', '$nor', '$and'].includes(fieldName)) {
      const clauses = [];
      const clauseValues = [];
      fieldValue.forEach(subQuery => {
        const clause = buildWhereClause({
          schema,
          query: subQuery,
          index
        });

        if (clause.pattern.length > 0) {
          clauses.push(clause.pattern);
          clauseValues.push(...clause.values);
          index += clause.values.length;
        }
      });
      const orOrAnd = fieldName === '$and' ? ' AND ' : ' OR ';
      const not = fieldName === '$nor' ? ' NOT ' : '';
      patterns.push(`${not}(${clauses.join(orOrAnd)})`);
      values.push(...clauseValues);
    }

    if (fieldValue.$ne !== undefined) {
      if (isArrayField) {
        fieldValue.$ne = JSON.stringify([fieldValue.$ne]);
        patterns.push(`NOT array_contains($${index}:name, $${index + 1})`);
      } else {
        if (fieldValue.$ne === null) {
          patterns.push(`$${index}:name IS NOT NULL`);
          values.push(fieldName);
          index += 1;
          continue;
        } else {
          // if not null, we need to manually exclude null
          patterns.push(`($${index}:name <> $${index + 1} OR $${index}:name IS NULL)`);
        }
      } // TODO: support arrays


      values.push(fieldName, fieldValue.$ne);
      index += 2;
    }

    if (fieldValue.$eq !== undefined) {
      if (fieldValue.$eq === null) {
        patterns.push(`$${index}:name IS NULL`);
        values.push(fieldName);
        index += 1;
      } else {
        patterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue.$eq);
        index += 2;
      }
    }

    const isInOrNin = Array.isArray(fieldValue.$in) || Array.isArray(fieldValue.$nin);

    if (Array.isArray(fieldValue.$in) && isArrayField && schema.fields[fieldName].contents && schema.fields[fieldName].contents.type === 'String') {
      const inPatterns = [];
      let allowNull = false;
      values.push(fieldName);
      fieldValue.$in.forEach((listElem, listIndex) => {
        if (listElem === null) {
          allowNull = true;
        } else {
          values.push(listElem);
          inPatterns.push(`$${index + 1 + listIndex - (allowNull ? 1 : 0)}`);
        }
      });

      if (allowNull) {
        patterns.push(`($${index}:name IS NULL OR $${index}:name && ARRAY[${inPatterns.join()}])`);
      } else {
        patterns.push(`$${index}:name && ARRAY[${inPatterns.join()}]`);
      }

      index = index + 1 + inPatterns.length;
    } else if (isInOrNin) {
      var createConstraint = (baseArray, notIn) => {
        const not = notIn ? ' NOT ' : '';

        if (baseArray.length > 0) {
          if (isArrayField) {
            patterns.push(`${not} array_contains($${index}:name, $${index + 1})`);
            values.push(fieldName, JSON.stringify(baseArray));
            index += 2;
          } else {
            // Handle Nested Dot Notation Above
            if (fieldName.indexOf('.') >= 0) {
              return;
            }

            const inPatterns = [];
            values.push(fieldName);
            baseArray.forEach((listElem, listIndex) => {
              if (listElem !== null) {
                values.push(listElem);
                inPatterns.push(`$${index + 1 + listIndex}`);
              }
            });
            patterns.push(`$${index}:name ${not} IN (${inPatterns.join()})`);
            index = index + 1 + inPatterns.length;
          }
        } else if (!notIn) {
          values.push(fieldName);
          patterns.push(`$${index}:name IS NULL`);
          index = index + 1;
        } else {
          // Handle empty array
          if (notIn) {
            patterns.push('1 = 1'); // Return all values
          } else {
            patterns.push('1 = 2'); // Return no values
          }
        }
      };

      if (fieldValue.$in) {
        createConstraint(_lodash.default.flatMap(fieldValue.$in, elt => elt), false);
      }

      if (fieldValue.$nin) {
        createConstraint(_lodash.default.flatMap(fieldValue.$nin, elt => elt), true);
      }
    } else if (typeof fieldValue.$in !== 'undefined') {
      throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $in value');
    } else if (typeof fieldValue.$nin !== 'undefined') {
      throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $nin value');
    }

    if (Array.isArray(fieldValue.$all) && isArrayField) {
      if (isAnyValueRegexStartsWith(fieldValue.$all)) {
        if (!isAllValuesRegexOrNone(fieldValue.$all)) {
          throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'All $all values must be of regex type or none: ' + fieldValue.$all);
        }

        for (let i = 0; i < fieldValue.$all.length; i += 1) {
          const value = processRegexPattern(fieldValue.$all[i].$regex);
          fieldValue.$all[i] = value.substring(1) + '%';
        }

        patterns.push(`array_contains_all_regex($${index}:name, $${index + 1}::jsonb)`);
      } else {
        patterns.push(`array_contains_all($${index}:name, $${index + 1}::jsonb)`);
      }

      values.push(fieldName, JSON.stringify(fieldValue.$all));
      index += 2;
    }

    if (typeof fieldValue.$exists !== 'undefined') {
      if (fieldValue.$exists) {
        patterns.push(`$${index}:name IS NOT NULL`);
      } else {
        patterns.push(`$${index}:name IS NULL`);
      }

      values.push(fieldName);
      index += 1;
    }

    if (fieldValue.$containedBy) {
      const arr = fieldValue.$containedBy;

      if (!(arr instanceof Array)) {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $containedBy: should be an array`);
      }

      patterns.push(`$${index}:name <@ $${index + 1}::jsonb`);
      values.push(fieldName, JSON.stringify(arr));
      index += 2;
    }

    if (fieldValue.$text) {
      const search = fieldValue.$text.$search;
      let language = 'english';

      if (typeof search !== 'object') {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $text: $search, should be object`);
      }

      if (!search.$term || typeof search.$term !== 'string') {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $text: $term, should be string`);
      }

      if (search.$language && typeof search.$language !== 'string') {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $text: $language, should be string`);
      } else if (search.$language) {
        language = search.$language;
      }

      if (search.$caseSensitive && typeof search.$caseSensitive !== 'boolean') {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $text: $caseSensitive, should be boolean`);
      } else if (search.$caseSensitive) {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $text: $caseSensitive not supported, please use $regex or create a separate lower case column.`);
      }

      if (search.$diacriticSensitive && typeof search.$diacriticSensitive !== 'boolean') {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $text: $diacriticSensitive, should be boolean`);
      } else if (search.$diacriticSensitive === false) {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $text: $diacriticSensitive - false not supported, install Postgres Unaccent Extension`);
      }

      patterns.push(`to_tsvector($${index}, $${index + 1}:name) @@ to_tsquery($${index + 2}, $${index + 3})`);
      values.push(language, fieldName, language, search.$term);
      index += 4;
    }

    if (fieldValue.$nearSphere) {
      const point = fieldValue.$nearSphere;
      const distance = fieldValue.$maxDistance;
      const distanceInKM = distance * 6371 * 1000;
      patterns.push(`ST_distance_sphere($${index}:name::geometry, POINT($${index + 1}, $${index + 2})::geometry) <= $${index + 3}`);
      sorts.push(`ST_distance_sphere($${index}:name::geometry, POINT($${index + 1}, $${index + 2})::geometry) ASC`);
      values.push(fieldName, point.longitude, point.latitude, distanceInKM);
      index += 4;
    }

    if (fieldValue.$within && fieldValue.$within.$box) {
      const box = fieldValue.$within.$box;
      const left = box[0].longitude;
      const bottom = box[0].latitude;
      const right = box[1].longitude;
      const top = box[1].latitude;
      patterns.push(`$${index}:name::point <@ $${index + 1}::box`);
      values.push(fieldName, `((${left}, ${bottom}), (${right}, ${top}))`);
      index += 2;
    }

    if (fieldValue.$geoWithin && fieldValue.$geoWithin.$centerSphere) {
      const centerSphere = fieldValue.$geoWithin.$centerSphere;

      if (!(centerSphere instanceof Array) || centerSphere.length < 2) {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere should be an array of Parse.GeoPoint and distance');
      } // Get point, convert to geo point if necessary and validate


      let point = centerSphere[0];

      if (point instanceof Array && point.length === 2) {
        point = new _node.default.GeoPoint(point[1], point[0]);
      } else if (!GeoPointCoder.isValidJSON(point)) {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere geo point invalid');
      }

      _node.default.GeoPoint._validate(point.latitude, point.longitude); // Get distance and validate


      const distance = centerSphere[1];

      if (isNaN(distance) || distance < 0) {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere distance invalid');
      }

      const distanceInKM = distance * 6371 * 1000;
      patterns.push(`ST_distance_sphere($${index}:name::geometry, POINT($${index + 1}, $${index + 2})::geometry) <= $${index + 3}`);
      values.push(fieldName, point.longitude, point.latitude, distanceInKM);
      index += 4;
    }

    if (fieldValue.$geoWithin && fieldValue.$geoWithin.$polygon) {
      const polygon = fieldValue.$geoWithin.$polygon;
      let points;

      if (typeof polygon === 'object' && polygon.__type === 'Polygon') {
        if (!polygon.coordinates || polygon.coordinates.length < 3) {
          throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $geoWithin value; Polygon.coordinates should contain at least 3 lon/lat pairs');
        }

        points = polygon.coordinates;
      } else if (polygon instanceof Array) {
        if (polygon.length < 3) {
          throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $geoWithin value; $polygon should contain at least 3 GeoPoints');
        }

        points = polygon;
      } else {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, "bad $geoWithin value; $polygon should be Polygon object or Array of Parse.GeoPoint's");
      }

      points = points.map(point => {
        if (point instanceof Array && point.length === 2) {
          _node.default.GeoPoint._validate(point[1], point[0]);

          return `(${point[0]}, ${point[1]})`;
        }

        if (typeof point !== 'object' || point.__type !== 'GeoPoint') {
          throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $geoWithin value');
        } else {
          _node.default.GeoPoint._validate(point.latitude, point.longitude);
        }

        return `(${point.longitude}, ${point.latitude})`;
      }).join(', ');
      patterns.push(`$${index}:name::point <@ $${index + 1}::polygon`);
      values.push(fieldName, `(${points})`);
      index += 2;
    }

    if (fieldValue.$geoIntersects && fieldValue.$geoIntersects.$point) {
      const point = fieldValue.$geoIntersects.$point;

      if (typeof point !== 'object' || point.__type !== 'GeoPoint') {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $geoIntersect value; $point should be GeoPoint');
      } else {
        _node.default.GeoPoint._validate(point.latitude, point.longitude);
      }

      patterns.push(`$${index}:name::polygon @> $${index + 1}::point`);
      values.push(fieldName, `(${point.longitude}, ${point.latitude})`);
      index += 2;
    }

    if (fieldValue.$regex) {
      let regex = fieldValue.$regex;
      let operator = '~';
      const opts = fieldValue.$options;

      if (opts) {
        if (opts.indexOf('i') >= 0) {
          operator = '~*';
        }

        if (opts.indexOf('x') >= 0) {
          regex = removeWhiteSpace(regex);
        }
      }

      const name = transformDotField(fieldName);
      regex = processRegexPattern(regex);
      patterns.push(`$${index}:raw ${operator} '$${index + 1}:raw'`);
      values.push(name, regex);
      index += 2;
    }

    if (fieldValue.__type === 'Pointer') {
      if (isArrayField) {
        patterns.push(`array_contains($${index}:name, $${index + 1})`);
        values.push(fieldName, JSON.stringify([fieldValue]));
        index += 2;
      } else {
        patterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue.objectId);
        index += 2;
      }
    }

    if (fieldValue.__type === 'Date') {
      patterns.push(`$${index}:name = $${index + 1}`);
      values.push(fieldName, fieldValue.iso);
      index += 2;
    }

    if (fieldValue.__type === 'GeoPoint') {
      patterns.push('$' + index + ':name ~= POINT($' + (index + 1) + ', $' + (index + 2) + ')');
      values.push(fieldName, fieldValue.longitude, fieldValue.latitude);
      index += 3;
    }

    if (fieldValue.__type === 'Polygon') {
      const value = convertPolygonToSQL(fieldValue.coordinates);
      patterns.push(`$${index}:name ~= $${index + 1}::polygon`);
      values.push(fieldName, value);
      index += 2;
    }

    Object.keys(ParseToPosgresComparator).forEach(cmp => {
      if (fieldValue[cmp] || fieldValue[cmp] === 0) {
        const pgComparator = ParseToPosgresComparator[cmp];
        patterns.push(`$${index}:name ${pgComparator} $${index + 1}`);
        values.push(fieldName, toPostgresValue(fieldValue[cmp]));
        index += 2;
      }
    });

    if (initialPatternsLength === patterns.length) {
      throw new _node.default.Error(_node.default.Error.OPERATION_FORBIDDEN, `Postgres doesn't support this query type yet ${JSON.stringify(fieldValue)}`);
    }
  }

  values = values.map(transformValue);
  return {
    pattern: patterns.join(' AND '),
    values,
    sorts
  };
};

class PostgresStorageAdapter {
  // Private
  constructor({
    uri,
    collectionPrefix = '',
    databaseOptions
  }) {
    this._collectionPrefix = collectionPrefix;
    const {
      client,
      pgp
    } = (0, _PostgresClient.createClient)(uri, databaseOptions);
    this._client = client;
    this._pgp = pgp;
    this.canSortOnJoinTables = false;
  }

  handleShutdown() {
    if (!this._client) {
      return;
    }

    this._client.$pool.end();
  }

  _ensureSchemaCollectionExists(conn) {
    conn = conn || this._client;
    return conn.none('CREATE TABLE IF NOT EXISTS "_SCHEMA" ( "className" varChar(120), "schema" jsonb, "isParseClass" bool, PRIMARY KEY ("className") )').catch(error => {
      if (error.code === PostgresDuplicateRelationError || error.code === PostgresUniqueIndexViolationError || error.code === PostgresDuplicateObjectError) {// Table already exists, must have been created by a different request. Ignore error.
      } else {
        throw error;
      }
    });
  }

  classExists(name) {
    return this._client.one('SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1)', [name], a => a.exists);
  }

  setClassLevelPermissions(className, CLPs) {
    const self = this;
    return this._client.task('set-class-level-permissions', function* (t) {
      yield self._ensureSchemaCollectionExists(t);
      const values = [className, 'schema', 'classLevelPermissions', JSON.stringify(CLPs)];
      yield t.none(`UPDATE "_SCHEMA" SET $2:name = json_object_set_key($2:name, $3::text, $4::jsonb) WHERE "className"=$1`, values);
    });
  }

  setIndexesWithSchemaFormat(className, submittedIndexes, existingIndexes = {}, fields, conn) {
    conn = conn || this._client;
    const self = this;

    if (submittedIndexes === undefined) {
      return Promise.resolve();
    }

    if (Object.keys(existingIndexes).length === 0) {
      existingIndexes = {
        _id_: {
          _id: 1
        }
      };
    }

    const deletedIndexes = [];
    const insertedIndexes = [];
    Object.keys(submittedIndexes).forEach(name => {
      const field = submittedIndexes[name];

      if (existingIndexes[name] && field.__op !== 'Delete') {
        throw new _node.default.Error(_node.default.Error.INVALID_QUERY, `Index ${name} exists, cannot update.`);
      }

      if (!existingIndexes[name] && field.__op === 'Delete') {
        throw new _node.default.Error(_node.default.Error.INVALID_QUERY, `Index ${name} does not exist, cannot delete.`);
      }

      if (field.__op === 'Delete') {
        deletedIndexes.push(name);
        delete existingIndexes[name];
      } else {
        Object.keys(field).forEach(key => {
          if (!fields.hasOwnProperty(key)) {
            throw new _node.default.Error(_node.default.Error.INVALID_QUERY, `Field ${key} does not exist, cannot add index.`);
          }
        });
        existingIndexes[name] = field;
        insertedIndexes.push({
          key: field,
          name
        });
      }
    });
    return conn.tx('set-indexes-with-schema-format', function* (t) {
      if (insertedIndexes.length > 0) {
        yield self.createIndexes(className, insertedIndexes, t);
      }

      if (deletedIndexes.length > 0) {
        yield self.dropIndexes(className, deletedIndexes, t);
      }

      yield self._ensureSchemaCollectionExists(t);
      yield t.none('UPDATE "_SCHEMA" SET $2:name = json_object_set_key($2:name, $3::text, $4::jsonb) WHERE "className"=$1', [className, 'schema', 'indexes', JSON.stringify(existingIndexes)]);
    });
  }

  createClass(className, schema, conn) {
    conn = conn || this._client;
    return conn.tx('create-class', t => {
      const q1 = this.createTable(className, schema, t);
      const q2 = t.none('INSERT INTO "_SCHEMA" ("className", "schema", "isParseClass") VALUES ($<className>, $<schema>, true)', {
        className,
        schema
      });
      const q3 = this.setIndexesWithSchemaFormat(className, schema.indexes, {}, schema.fields, t);
      return t.batch([q1, q2, q3]);
    }).then(() => {
      return toParseSchema(schema);
    }).catch(err => {
      if (err.data[0].result.code === PostgresTransactionAbortedError) {
        err = err.data[1].result;
      }

      if (err.code === PostgresUniqueIndexViolationError && err.detail.includes(className)) {
        throw new _node.default.Error(_node.default.Error.DUPLICATE_VALUE, `Class ${className} already exists.`);
      }

      throw err;
    });
  } // Just create a table, do not insert in schema


  createTable(className, schema, conn) {
    conn = conn || this._client;
    const self = this;
    debug('createTable', className, schema);
    const valuesArray = [];
    const patternsArray = [];
    const fields = Object.assign({}, schema.fields);

    if (className === '_User') {
      fields._email_verify_token_expires_at = {
        type: 'Date'
      };
      fields._email_verify_token = {
        type: 'String'
      };
      fields._account_lockout_expires_at = {
        type: 'Date'
      };
      fields._failed_login_count = {
        type: 'Number'
      };
      fields._perishable_token = {
        type: 'String'
      };
      fields._perishable_token_expires_at = {
        type: 'Date'
      };
      fields._password_changed_at = {
        type: 'Date'
      };
      fields._password_history = {
        type: 'Array'
      };
    }

    let index = 2;
    const relations = [];
    Object.keys(fields).forEach(fieldName => {
      const parseType = fields[fieldName]; // Skip when it's a relation
      // We'll create the tables later

      if (parseType.type === 'Relation') {
        relations.push(fieldName);
        return;
      }

      if (['_rperm', '_wperm'].indexOf(fieldName) >= 0) {
        parseType.contents = {
          type: 'String'
        };
      }

      valuesArray.push(fieldName);
      valuesArray.push(parseTypeToPostgresType(parseType));
      patternsArray.push(`$${index}:name $${index + 1}:raw`);

      if (fieldName === 'objectId') {
        patternsArray.push(`PRIMARY KEY ($${index}:name)`);
      }

      index = index + 2;
    });
    const qs = `CREATE TABLE IF NOT EXISTS $1:name (${patternsArray.join()})`;
    const values = [className, ...valuesArray];
    debug(qs, values);
    return conn.task('create-table', function* (t) {
      try {
        yield self._ensureSchemaCollectionExists(t);
        yield t.none(qs, values);
      } catch (error) {
        if (error.code !== PostgresDuplicateRelationError) {
          throw error;
        } // ELSE: Table already exists, must have been created by a different request. Ignore the error.

      }

      yield t.tx('create-table-tx', tx => {
        return tx.batch(relations.map(fieldName => {
          return tx.none('CREATE TABLE IF NOT EXISTS $<joinTable:name> ("relatedId" varChar(120), "owningId" varChar(120), PRIMARY KEY("relatedId", "owningId") )', {
            joinTable: `_Join:${fieldName}:${className}`
          });
        }));
      });
    });
  }

  schemaUpgrade(className, schema, conn) {
    debug('schemaUpgrade', {
      className,
      schema
    });
    conn = conn || this._client;
    const self = this;
    return conn.tx('schema-upgrade', function* (t) {
      const columns = yield t.map('SELECT column_name FROM information_schema.columns WHERE table_name = $<className>', {
        className
      }, a => a.column_name);
      const newColumns = Object.keys(schema.fields).filter(item => columns.indexOf(item) === -1).map(fieldName => self.addFieldIfNotExists(className, fieldName, schema.fields[fieldName], t));
      yield t.batch(newColumns);
    });
  }

  addFieldIfNotExists(className, fieldName, type, conn) {
    // TODO: Must be revised for invalid logic...
    debug('addFieldIfNotExists', {
      className,
      fieldName,
      type
    });
    conn = conn || this._client;
    const self = this;
    return conn.tx('add-field-if-not-exists', function* (t) {
      if (type.type !== 'Relation') {
        try {
          yield t.none('ALTER TABLE $<className:name> ADD COLUMN $<fieldName:name> $<postgresType:raw>', {
            className,
            fieldName,
            postgresType: parseTypeToPostgresType(type)
          });
        } catch (error) {
          if (error.code === PostgresRelationDoesNotExistError) {
            return yield self.createClass(className, {
              fields: {
                [fieldName]: type
              }
            }, t);
          }

          if (error.code !== PostgresDuplicateColumnError) {
            throw error;
          } // Column already exists, created by other request. Carry on to see if it's the right type.

        }
      } else {
        yield t.none('CREATE TABLE IF NOT EXISTS $<joinTable:name> ("relatedId" varChar(120), "owningId" varChar(120), PRIMARY KEY("relatedId", "owningId") )', {
          joinTable: `_Join:${fieldName}:${className}`
        });
      }

      const result = yield t.any('SELECT "schema" FROM "_SCHEMA" WHERE "className" = $<className> and ("schema"::json->\'fields\'->$<fieldName>) is not null', {
        className,
        fieldName
      });

      if (result[0]) {
        throw 'Attempted to add a field that already exists';
      } else {
        const path = `{fields,${fieldName}}`;
        yield t.none('UPDATE "_SCHEMA" SET "schema"=jsonb_set("schema", $<path>, $<type>)  WHERE "className"=$<className>', {
          path,
          type,
          className
        });
      }
    });
  } // Drops a collection. Resolves with true if it was a Parse Schema (eg. _User, Custom, etc.)
  // and resolves with false if it wasn't (eg. a join table). Rejects if deletion was impossible.


  deleteClass(className) {
    const operations = [{
      query: `DROP TABLE IF EXISTS $1:name`,
      values: [className]
    }, {
      query: `DELETE FROM "_SCHEMA" WHERE "className" = $1`,
      values: [className]
    }];
    return this._client.tx(t => t.none(this._pgp.helpers.concat(operations))).then(() => className.indexOf('_Join:') != 0); // resolves with false when _Join table
  } // Delete all data known to this adapter. Used for testing.


  deleteAllClasses() {
    const now = new Date().getTime();
    const helpers = this._pgp.helpers;
    debug('deleteAllClasses');
    return this._client.task('delete-all-classes', function* (t) {
      try {
        const results = yield t.any('SELECT * FROM "_SCHEMA"');
        const joins = results.reduce((list, schema) => {
          return list.concat(joinTablesForSchema(schema.schema));
        }, []);
        const classes = ['_SCHEMA', '_PushStatus', '_JobStatus', '_JobSchedule', '_Hooks', '_GlobalConfig', '_Audience', ...results.map(result => result.className), ...joins];
        const queries = classes.map(className => ({
          query: 'DROP TABLE IF EXISTS $<className:name>',
          values: {
            className
          }
        }));
        yield t.tx(tx => tx.none(helpers.concat(queries)));
      } catch (error) {
        if (error.code !== PostgresRelationDoesNotExistError) {
          throw error;
        } // No _SCHEMA collection. Don't delete anything.

      }
    }).then(() => {
      debug(`deleteAllClasses done in ${new Date().getTime() - now}`);
    });
  } // Remove the column and all the data. For Relations, the _Join collection is handled
  // specially, this function does not delete _Join columns. It should, however, indicate
  // that the relation fields does not exist anymore. In mongo, this means removing it from
  // the _SCHEMA collection.  There should be no actual data in the collection under the same name
  // as the relation column, so it's fine to attempt to delete it. If the fields listed to be
  // deleted do not exist, this function should return successfully anyways. Checking for
  // attempts to delete non-existent fields is the responsibility of Parse Server.
  // This function is not obligated to delete fields atomically. It is given the field
  // names in a list so that databases that are capable of deleting fields atomically
  // may do so.
  // Returns a Promise.


  deleteFields(className, schema, fieldNames) {
    debug('deleteFields', className, fieldNames);
    fieldNames = fieldNames.reduce((list, fieldName) => {
      const field = schema.fields[fieldName];

      if (field.type !== 'Relation') {
        list.push(fieldName);
      }

      delete schema.fields[fieldName];
      return list;
    }, []);
    const values = [className, ...fieldNames];
    const columns = fieldNames.map((name, idx) => {
      return `$${idx + 2}:name`;
    }).join(', DROP COLUMN');
    return this._client.tx('delete-fields', function* (t) {
      yield t.none('UPDATE "_SCHEMA" SET "schema"=$<schema> WHERE "className"=$<className>', {
        schema,
        className
      });

      if (values.length > 1) {
        yield t.none(`ALTER TABLE $1:name DROP COLUMN ${columns}`, values);
      }
    });
  } // Return a promise for all schemas known to this adapter, in Parse format. In case the
  // schemas cannot be retrieved, returns a promise that rejects. Requirements for the
  // rejection reason are TBD.


  getAllClasses() {
    const self = this;
    return this._client.task('get-all-classes', function* (t) {
      yield self._ensureSchemaCollectionExists(t);
      return yield t.map('SELECT * FROM "_SCHEMA"', null, row => toParseSchema(_objectSpread({
        className: row.className
      }, row.schema)));
    });
  } // Return a promise for the schema with the given name, in Parse format. If
  // this adapter doesn't know about the schema, return a promise that rejects with
  // undefined as the reason.


  getClass(className) {
    debug('getClass', className);
    return this._client.any('SELECT * FROM "_SCHEMA" WHERE "className"=$<className>', {
      className
    }).then(result => {
      if (result.length !== 1) {
        throw undefined;
      }

      return result[0].schema;
    }).then(toParseSchema);
  } // TODO: remove the mongo format dependency in the return value


  createObject(className, schema, object) {
    debug('createObject', className, object);
    let columnsArray = [];
    const valuesArray = [];
    schema = toPostgresSchema(schema);
    const geoPoints = {};
    object = handleDotFields(object);
    validateKeys(object);
    Object.keys(object).forEach(fieldName => {
      if (object[fieldName] === null) {
        return;
      }

      var authDataMatch = fieldName.match(/^_auth_data_([a-zA-Z0-9_]+)$/);

      if (authDataMatch) {
        var provider = authDataMatch[1];
        object['authData'] = object['authData'] || {};
        object['authData'][provider] = object[fieldName];
        delete object[fieldName];
        fieldName = 'authData';
      }

      columnsArray.push(fieldName);

      if (!schema.fields[fieldName] && className === '_User') {
        if (fieldName === '_email_verify_token' || fieldName === '_failed_login_count' || fieldName === '_perishable_token' || fieldName === '_password_history') {
          valuesArray.push(object[fieldName]);
        }

        if (fieldName === '_email_verify_token_expires_at') {
          if (object[fieldName]) {
            valuesArray.push(object[fieldName].iso);
          } else {
            valuesArray.push(null);
          }
        }

        if (fieldName === '_account_lockout_expires_at' || fieldName === '_perishable_token_expires_at' || fieldName === '_password_changed_at') {
          if (object[fieldName]) {
            valuesArray.push(object[fieldName].iso);
          } else {
            valuesArray.push(null);
          }
        }

        return;
      }

      switch (schema.fields[fieldName].type) {
        case 'Date':
          if (object[fieldName]) {
            valuesArray.push(object[fieldName].iso);
          } else {
            valuesArray.push(null);
          }

          break;

        case 'Pointer':
          valuesArray.push(object[fieldName].objectId);
          break;

        case 'Array':
          if (['_rperm', '_wperm'].indexOf(fieldName) >= 0) {
            valuesArray.push(object[fieldName]);
          } else {
            valuesArray.push(JSON.stringify(object[fieldName]));
          }

          break;

        case 'Object':
        case 'Bytes':
        case 'String':
        case 'Number':
        case 'Boolean':
          valuesArray.push(object[fieldName]);
          break;

        case 'File':
          valuesArray.push(object[fieldName].name);
          break;

        case 'Polygon':
          {
            const value = convertPolygonToSQL(object[fieldName].coordinates);
            valuesArray.push(value);
            break;
          }

        case 'GeoPoint':
          // pop the point and process later
          geoPoints[fieldName] = object[fieldName];
          columnsArray.pop();
          break;

        default:
          throw `Type ${schema.fields[fieldName].type} not supported yet`;
      }
    });
    columnsArray = columnsArray.concat(Object.keys(geoPoints));
    const initialValues = valuesArray.map((val, index) => {
      let termination = '';
      const fieldName = columnsArray[index];

      if (['_rperm', '_wperm'].indexOf(fieldName) >= 0) {
        termination = '::text[]';
      } else if (schema.fields[fieldName] && schema.fields[fieldName].type === 'Array') {
        termination = '::jsonb';
      }

      return `$${index + 2 + columnsArray.length}${termination}`;
    });
    const geoPointsInjects = Object.keys(geoPoints).map(key => {
      const value = geoPoints[key];
      valuesArray.push(value.longitude, value.latitude);
      const l = valuesArray.length + columnsArray.length;
      return `POINT($${l}, $${l + 1})`;
    });
    const columnsPattern = columnsArray.map((col, index) => `$${index + 2}:name`).join();
    const valuesPattern = initialValues.concat(geoPointsInjects).join();
    const qs = `INSERT INTO $1:name (${columnsPattern}) VALUES (${valuesPattern})`;
    const values = [className, ...columnsArray, ...valuesArray];
    debug(qs, values);
    return this._client.none(qs, values).then(() => ({
      ops: [object]
    })).catch(error => {
      if (error.code === PostgresUniqueIndexViolationError) {
        const err = new _node.default.Error(_node.default.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
        err.underlyingError = error;

        if (error.constraint) {
          const matches = error.constraint.match(/unique_([a-zA-Z]+)/);

          if (matches && Array.isArray(matches)) {
            err.userInfo = {
              duplicated_field: matches[1]
            };
          }
        }

        error = err;
      }

      throw error;
    });
  } // Remove all objects that match the given Parse Query.
  // If no objects match, reject with OBJECT_NOT_FOUND. If objects are found and deleted, resolve with undefined.
  // If there is some other error, reject with INTERNAL_SERVER_ERROR.


  deleteObjectsByQuery(className, schema, query) {
    debug('deleteObjectsByQuery', className, query);
    const values = [className];
    const index = 2;
    const where = buildWhereClause({
      schema,
      index,
      query
    });
    values.push(...where.values);

    if (Object.keys(query).length === 0) {
      where.pattern = 'TRUE';
    }

    const qs = `WITH deleted AS (DELETE FROM $1:name WHERE ${where.pattern} RETURNING *) SELECT count(*) FROM deleted`;
    debug(qs, values);
    return this._client.one(qs, values, a => +a.count).then(count => {
      if (count === 0) {
        throw new _node.default.Error(_node.default.Error.OBJECT_NOT_FOUND, 'Object not found.');
      } else {
        return count;
      }
    }).catch(error => {
      if (error.code !== PostgresRelationDoesNotExistError) {
        throw error;
      } // ELSE: Don't delete anything if doesn't exist

    });
  } // Return value not currently well specified.


  findOneAndUpdate(className, schema, query, update) {
    debug('findOneAndUpdate', className, query, update);
    return this.updateObjectsByQuery(className, schema, query, update).then(val => val[0]);
  } // Apply the update to all objects that match the given Parse Query.


  updateObjectsByQuery(className, schema, query, update) {
    debug('updateObjectsByQuery', className, query, update);
    const updatePatterns = [];
    const values = [className];
    let index = 2;
    schema = toPostgresSchema(schema);

    const originalUpdate = _objectSpread({}, update); // Set flag for dot notation fields


    const dotNotationOptions = {};
    Object.keys(update).forEach(fieldName => {
      if (fieldName.indexOf('.') > -1) {
        const components = fieldName.split('.');
        const first = components.shift();
        dotNotationOptions[first] = true;
      } else {
        dotNotationOptions[fieldName] = false;
      }
    });
    update = handleDotFields(update); // Resolve authData first,
    // So we don't end up with multiple key updates

    for (const fieldName in update) {
      const authDataMatch = fieldName.match(/^_auth_data_([a-zA-Z0-9_]+)$/);

      if (authDataMatch) {
        var provider = authDataMatch[1];
        const value = update[fieldName];
        delete update[fieldName];
        update['authData'] = update['authData'] || {};
        update['authData'][provider] = value;
      }
    }

    for (const fieldName in update) {
      const fieldValue = update[fieldName]; // Drop any undefined values.

      if (typeof fieldValue === 'undefined') {
        delete update[fieldName];
      } else if (fieldValue === null) {
        updatePatterns.push(`$${index}:name = NULL`);
        values.push(fieldName);
        index += 1;
      } else if (fieldName == 'authData') {
        // This recursively sets the json_object
        // Only 1 level deep
        const generate = (jsonb, key, value) => {
          return `json_object_set_key(COALESCE(${jsonb}, '{}'::jsonb), ${key}, ${value})::jsonb`;
        };

        const lastKey = `$${index}:name`;
        const fieldNameIndex = index;
        index += 1;
        values.push(fieldName);
        const update = Object.keys(fieldValue).reduce((lastKey, key) => {
          const str = generate(lastKey, `$${index}::text`, `$${index + 1}::jsonb`);
          index += 2;
          let value = fieldValue[key];

          if (value) {
            if (value.__op === 'Delete') {
              value = null;
            } else {
              value = JSON.stringify(value);
            }
          }

          values.push(key, value);
          return str;
        }, lastKey);
        updatePatterns.push(`$${fieldNameIndex}:name = ${update}`);
      } else if (fieldValue.__op === 'Increment') {
        updatePatterns.push(`$${index}:name = COALESCE($${index}:name, 0) + $${index + 1}`);
        values.push(fieldName, fieldValue.amount);
        index += 2;
      } else if (fieldValue.__op === 'Add') {
        updatePatterns.push(`$${index}:name = array_add(COALESCE($${index}:name, '[]'::jsonb), $${index + 1}::jsonb)`);
        values.push(fieldName, JSON.stringify(fieldValue.objects));
        index += 2;
      } else if (fieldValue.__op === 'Delete') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, null);
        index += 2;
      } else if (fieldValue.__op === 'Remove') {
        updatePatterns.push(`$${index}:name = array_remove(COALESCE($${index}:name, '[]'::jsonb), $${index + 1}::jsonb)`);
        values.push(fieldName, JSON.stringify(fieldValue.objects));
        index += 2;
      } else if (fieldValue.__op === 'AddUnique') {
        updatePatterns.push(`$${index}:name = array_add_unique(COALESCE($${index}:name, '[]'::jsonb), $${index + 1}::jsonb)`);
        values.push(fieldName, JSON.stringify(fieldValue.objects));
        index += 2;
      } else if (fieldName === 'updatedAt') {
        //TODO: stop special casing this. It should check for __type === 'Date' and use .iso
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (typeof fieldValue === 'string') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (typeof fieldValue === 'boolean') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (fieldValue.__type === 'Pointer') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue.objectId);
        index += 2;
      } else if (fieldValue.__type === 'Date') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, toPostgresValue(fieldValue));
        index += 2;
      } else if (fieldValue instanceof Date) {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (fieldValue.__type === 'File') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, toPostgresValue(fieldValue));
        index += 2;
      } else if (fieldValue.__type === 'GeoPoint') {
        updatePatterns.push(`$${index}:name = POINT($${index + 1}, $${index + 2})`);
        values.push(fieldName, fieldValue.longitude, fieldValue.latitude);
        index += 3;
      } else if (fieldValue.__type === 'Polygon') {
        const value = convertPolygonToSQL(fieldValue.coordinates);
        updatePatterns.push(`$${index}:name = $${index + 1}::polygon`);
        values.push(fieldName, value);
        index += 2;
      } else if (fieldValue.__type === 'Relation') {// noop
      } else if (typeof fieldValue === 'number') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (typeof fieldValue === 'object' && schema.fields[fieldName] && schema.fields[fieldName].type === 'Object') {
        // Gather keys to increment
        const keysToIncrement = Object.keys(originalUpdate).filter(k => {
          // choose top level fields that have a delete operation set
          // Note that Object.keys is iterating over the **original** update object
          // and that some of the keys of the original update could be null or undefined:
          // (See the above check `if (fieldValue === null || typeof fieldValue == "undefined")`)
          const value = originalUpdate[k];
          return value && value.__op === 'Increment' && k.split('.').length === 2 && k.split('.')[0] === fieldName;
        }).map(k => k.split('.')[1]);
        let incrementPatterns = '';

        if (keysToIncrement.length > 0) {
          incrementPatterns = ' || ' + keysToIncrement.map(c => {
            const amount = fieldValue[c].amount;
            return `CONCAT('{"${c}":', COALESCE($${index}:name->>'${c}','0')::int + ${amount}, '}')::jsonb`;
          }).join(' || '); // Strip the keys

          keysToIncrement.forEach(key => {
            delete fieldValue[key];
          });
        }

        const keysToDelete = Object.keys(originalUpdate).filter(k => {
          // choose top level fields that have a delete operation set.
          const value = originalUpdate[k];
          return value && value.__op === 'Delete' && k.split('.').length === 2 && k.split('.')[0] === fieldName;
        }).map(k => k.split('.')[1]);
        const deletePatterns = keysToDelete.reduce((p, c, i) => {
          return p + ` - '$${index + 1 + i}:value'`;
        }, ''); // Override Object

        let updateObject = "'{}'::jsonb";

        if (dotNotationOptions[fieldName]) {
          // Merge Object
          updateObject = `COALESCE($${index}:name, '{}'::jsonb)`;
        }

        updatePatterns.push(`$${index}:name = (${updateObject} ${deletePatterns} ${incrementPatterns} || $${index + 1 + keysToDelete.length}::jsonb )`);
        values.push(fieldName, ...keysToDelete, JSON.stringify(fieldValue));
        index += 2 + keysToDelete.length;
      } else if (Array.isArray(fieldValue) && schema.fields[fieldName] && schema.fields[fieldName].type === 'Array') {
        const expectedType = parseTypeToPostgresType(schema.fields[fieldName]);

        if (expectedType === 'text[]') {
          updatePatterns.push(`$${index}:name = $${index + 1}::text[]`);
          values.push(fieldName, fieldValue);
          index += 2;
        } else {
          values.push(fieldName);

          const buildSQLArray = fieldValue => {
            let pattern = 'json_build_array(';

            for (let i = 0; i < fieldValue.length; i += 1) {
              const element = fieldValue[i];
              let type = '';

              if (Array.isArray(element)) {
                pattern += buildSQLArray(element) + ',';
                continue;
              } else if (typeof element == 'object') {
                type = '::json';
              }

              values.push(element);
              pattern += `$${index + 1}${type},`;
              index += 1;
            } // remove last comma


            if (fieldValue.length > 0) {
              pattern = pattern.slice(0, -1);
            }

            pattern += ')';
            return pattern;
          };

          const sql = `$${index}:name = ${buildSQLArray(fieldValue)}`;
          updatePatterns.push(sql);
          index += 1;
        }
      } else {
        debug('Not supported update', fieldName, fieldValue);
        return Promise.reject(new _node.default.Error(_node.default.Error.OPERATION_FORBIDDEN, `Postgres doesn't support update ${JSON.stringify(fieldValue)} yet`));
      }
    }

    const where = buildWhereClause({
      schema,
      index,
      query
    });
    values.push(...where.values);
    const whereClause = where.pattern.length > 0 ? `WHERE ${where.pattern}` : '';
    const qs = `UPDATE $1:name SET ${updatePatterns.join()} ${whereClause} RETURNING *`;
    debug('update: ', qs, values);
    return this._client.any(qs, values);
  } // Hopefully, we can get rid of this. It's only used for config and hooks.


  upsertOneObject(className, schema, query, update) {
    debug('upsertOneObject', {
      className,
      query,
      update
    });
    const createValue = Object.assign({}, query, update);
    return this.createObject(className, schema, createValue).catch(error => {
      // ignore duplicate value errors as it's upsert
      if (error.code !== _node.default.Error.DUPLICATE_VALUE) {
        throw error;
      }

      return this.findOneAndUpdate(className, schema, query, update);
    });
  }

  find(className, schema, query, {
    skip,
    limit,
    sort,
    keys
  }) {
    debug('find', className, query, {
      skip,
      limit,
      sort,
      keys
    });
    const hasLimit = limit !== undefined;
    const hasSkip = skip !== undefined;
    let values = [className];
    const where = buildWhereClause({
      schema,
      query,
      index: 2
    });
    values.push(...where.values);
    const wherePattern = where.pattern.length > 0 ? `WHERE ${where.pattern}` : '';
    const limitPattern = hasLimit ? `LIMIT $${values.length + 1}` : '';

    if (hasLimit) {
      values.push(limit);
    }

    const skipPattern = hasSkip ? `OFFSET $${values.length + 1}` : '';

    if (hasSkip) {
      values.push(skip);
    }

    let sortPattern = '';

    if (sort) {
      const sortCopy = sort;
      const sorting = Object.keys(sort).map(key => {
        const transformKey = transformDotFieldToComponents(key).join('->'); // Using $idx pattern gives:  non-integer constant in ORDER BY

        if (sortCopy[key] === 1) {
          return `${transformKey} ASC`;
        }

        return `${transformKey} DESC`;
      }).join();
      sortPattern = sort !== undefined && Object.keys(sort).length > 0 ? `ORDER BY ${sorting}` : '';
    }

    if (where.sorts && Object.keys(where.sorts).length > 0) {
      sortPattern = `ORDER BY ${where.sorts.join()}`;
    }

    let columns = '*';

    if (keys) {
      // Exclude empty keys
      // Replace ACL by it's keys
      keys = keys.reduce((memo, key) => {
        if (key === 'ACL') {
          memo.push('_rperm');
          memo.push('_wperm');
        } else if (key.length > 0) {
          memo.push(key);
        }

        return memo;
      }, []);
      columns = keys.map((key, index) => {
        if (key === '$score') {
          return `ts_rank_cd(to_tsvector($${2}, $${3}:name), to_tsquery($${4}, $${5}), 32) as score`;
        }

        return `$${index + values.length + 1}:name`;
      }).join();
      values = values.concat(keys);
    }

    const qs = `SELECT ${columns} FROM $1:name ${wherePattern} ${sortPattern} ${limitPattern} ${skipPattern}`;
    debug(qs, values);
    return this._client.any(qs, values).catch(error => {
      // Query on non existing table, don't crash
      if (error.code !== PostgresRelationDoesNotExistError) {
        throw error;
      }

      return [];
    }).then(results => results.map(object => this.postgresObjectToParseObject(className, object, schema)));
  } // Converts from a postgres-format object to a REST-format object.
  // Does not strip out anything based on a lack of authentication.


  postgresObjectToParseObject(className, object, schema) {
    Object.keys(schema.fields).forEach(fieldName => {
      if (schema.fields[fieldName].type === 'Pointer' && object[fieldName]) {
        object[fieldName] = {
          objectId: object[fieldName],
          __type: 'Pointer',
          className: schema.fields[fieldName].targetClass
        };
      }

      if (schema.fields[fieldName].type === 'Relation') {
        object[fieldName] = {
          __type: 'Relation',
          className: schema.fields[fieldName].targetClass
        };
      }

      if (object[fieldName] && schema.fields[fieldName].type === 'GeoPoint') {
        object[fieldName] = {
          __type: 'GeoPoint',
          latitude: object[fieldName].y,
          longitude: object[fieldName].x
        };
      }

      if (object[fieldName] && schema.fields[fieldName].type === 'Polygon') {
        let coords = object[fieldName];
        coords = coords.substr(2, coords.length - 4).split('),(');
        coords = coords.map(point => {
          return [parseFloat(point.split(',')[1]), parseFloat(point.split(',')[0])];
        });
        object[fieldName] = {
          __type: 'Polygon',
          coordinates: coords
        };
      }

      if (object[fieldName] && schema.fields[fieldName].type === 'File') {
        object[fieldName] = {
          __type: 'File',
          name: object[fieldName]
        };
      }
    }); //TODO: remove this reliance on the mongo format. DB adapter shouldn't know there is a difference between created at and any other date field.

    if (object.createdAt) {
      object.createdAt = object.createdAt.toISOString();
    }

    if (object.updatedAt) {
      object.updatedAt = object.updatedAt.toISOString();
    }

    if (object.expiresAt) {
      object.expiresAt = {
        __type: 'Date',
        iso: object.expiresAt.toISOString()
      };
    }

    if (object._email_verify_token_expires_at) {
      object._email_verify_token_expires_at = {
        __type: 'Date',
        iso: object._email_verify_token_expires_at.toISOString()
      };
    }

    if (object._account_lockout_expires_at) {
      object._account_lockout_expires_at = {
        __type: 'Date',
        iso: object._account_lockout_expires_at.toISOString()
      };
    }

    if (object._perishable_token_expires_at) {
      object._perishable_token_expires_at = {
        __type: 'Date',
        iso: object._perishable_token_expires_at.toISOString()
      };
    }

    if (object._password_changed_at) {
      object._password_changed_at = {
        __type: 'Date',
        iso: object._password_changed_at.toISOString()
      };
    }

    for (const fieldName in object) {
      if (object[fieldName] === null) {
        delete object[fieldName];
      }

      if (object[fieldName] instanceof Date) {
        object[fieldName] = {
          __type: 'Date',
          iso: object[fieldName].toISOString()
        };
      }
    }

    return object;
  } // Create a unique index. Unique indexes on nullable fields are not allowed. Since we don't
  // currently know which fields are nullable and which aren't, we ignore that criteria.
  // As such, we shouldn't expose this function to users of parse until we have an out-of-band
  // Way of determining if a field is nullable. Undefined doesn't count against uniqueness,
  // which is why we use sparse indexes.


  ensureUniqueness(className, schema, fieldNames) {
    // Use the same name for every ensureUniqueness attempt, because postgres
    // Will happily create the same index with multiple names.
    const constraintName = `unique_${fieldNames.sort().join('_')}`;
    const constraintPatterns = fieldNames.map((fieldName, index) => `$${index + 3}:name`);
    const qs = `ALTER TABLE $1:name ADD CONSTRAINT $2:name UNIQUE (${constraintPatterns.join()})`;
    return this._client.none(qs, [className, constraintName, ...fieldNames]).catch(error => {
      if (error.code === PostgresDuplicateRelationError && error.message.includes(constraintName)) {// Index already exists. Ignore error.
      } else if (error.code === PostgresUniqueIndexViolationError && error.message.includes(constraintName)) {
        // Cast the error into the proper parse error
        throw new _node.default.Error(_node.default.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
      } else {
        throw error;
      }
    });
  } // Executes a count.


  count(className, schema, query) {
    debug('count', className, query);
    const values = [className];
    const where = buildWhereClause({
      schema,
      query,
      index: 2
    });
    values.push(...where.values);
    const wherePattern = where.pattern.length > 0 ? `WHERE ${where.pattern}` : '';
    const qs = `SELECT count(*) FROM $1:name ${wherePattern}`;
    return this._client.one(qs, values, a => +a.count).catch(error => {
      if (error.code !== PostgresRelationDoesNotExistError) {
        throw error;
      }

      return 0;
    });
  }

  distinct(className, schema, query, fieldName) {
    debug('distinct', className, query);
    let field = fieldName;
    let column = fieldName;
    const isNested = fieldName.indexOf('.') >= 0;

    if (isNested) {
      field = transformDotFieldToComponents(fieldName).join('->');
      column = fieldName.split('.')[0];
    }

    const isArrayField = schema.fields && schema.fields[fieldName] && schema.fields[fieldName].type === 'Array';
    const isPointerField = schema.fields && schema.fields[fieldName] && schema.fields[fieldName].type === 'Pointer';
    const values = [field, column, className];
    const where = buildWhereClause({
      schema,
      query,
      index: 4
    });
    values.push(...where.values);
    const wherePattern = where.pattern.length > 0 ? `WHERE ${where.pattern}` : '';
    const transformer = isArrayField ? 'jsonb_array_elements' : 'ON';
    let qs = `SELECT DISTINCT ${transformer}($1:name) $2:name FROM $3:name ${wherePattern}`;

    if (isNested) {
      qs = `SELECT DISTINCT ${transformer}($1:raw) $2:raw FROM $3:name ${wherePattern}`;
    }

    debug(qs, values);
    return this._client.any(qs, values).catch(error => {
      if (error.code === PostgresMissingColumnError) {
        return [];
      }

      throw error;
    }).then(results => {
      if (!isNested) {
        results = results.filter(object => object[field] !== null);
        return results.map(object => {
          if (!isPointerField) {
            return object[field];
          }

          return {
            __type: 'Pointer',
            className: schema.fields[fieldName].targetClass,
            objectId: object[field]
          };
        });
      }

      const child = fieldName.split('.')[1];
      return results.map(object => object[column][child]);
    }).then(results => results.map(object => this.postgresObjectToParseObject(className, object, schema)));
  }

  aggregate(className, schema, pipeline) {
    debug('aggregate', className, pipeline);
    const values = [className];
    let index = 2;
    let columns = [];
    let countField = null;
    let groupValues = null;
    let wherePattern = '';
    let limitPattern = '';
    let skipPattern = '';
    let sortPattern = '';
    let groupPattern = '';

    for (let i = 0; i < pipeline.length; i += 1) {
      const stage = pipeline[i];

      if (stage.$group) {
        for (const field in stage.$group) {
          const value = stage.$group[field];

          if (value === null || value === undefined) {
            continue;
          }

          if (field === '_id' && typeof value === 'string' && value !== '') {
            columns.push(`$${index}:name AS "objectId"`);
            groupPattern = `GROUP BY $${index}:name`;
            values.push(transformAggregateField(value));
            index += 1;
            continue;
          }

          if (field === '_id' && typeof value === 'object' && Object.keys(value).length !== 0) {
            groupValues = value;
            const groupByFields = [];

            for (const alias in value) {
              const operation = Object.keys(value[alias])[0];
              const source = transformAggregateField(value[alias][operation]);

              if (mongoAggregateToPostgres[operation]) {
                if (!groupByFields.includes(`"${source}"`)) {
                  groupByFields.push(`"${source}"`);
                }

                columns.push(`EXTRACT(${mongoAggregateToPostgres[operation]} FROM $${index}:name AT TIME ZONE 'UTC') AS $${index + 1}:name`);
                values.push(source, alias);
                index += 2;
              }
            }

            groupPattern = `GROUP BY $${index}:raw`;
            values.push(groupByFields.join());
            index += 1;
            continue;
          }

          if (typeof value === 'object') {
            if (value.$sum) {
              if (typeof value.$sum === 'string') {
                columns.push(`SUM($${index}:name) AS $${index + 1}:name`);
                values.push(transformAggregateField(value.$sum), field);
                index += 2;
              } else {
                countField = field;
                columns.push(`COUNT(*) AS $${index}:name`);
                values.push(field);
                index += 1;
              }
            }

            if (value.$max) {
              columns.push(`MAX($${index}:name) AS $${index + 1}:name`);
              values.push(transformAggregateField(value.$max), field);
              index += 2;
            }

            if (value.$min) {
              columns.push(`MIN($${index}:name) AS $${index + 1}:name`);
              values.push(transformAggregateField(value.$min), field);
              index += 2;
            }

            if (value.$avg) {
              columns.push(`AVG($${index}:name) AS $${index + 1}:name`);
              values.push(transformAggregateField(value.$avg), field);
              index += 2;
            }
          }
        }
      } else {
        columns.push('*');
      }

      if (stage.$project) {
        if (columns.includes('*')) {
          columns = [];
        }

        for (const field in stage.$project) {
          const value = stage.$project[field];

          if (value === 1 || value === true) {
            columns.push(`$${index}:name`);
            values.push(field);
            index += 1;
          }
        }
      }

      if (stage.$match) {
        const patterns = [];
        const orOrAnd = stage.$match.hasOwnProperty('$or') ? ' OR ' : ' AND ';

        if (stage.$match.$or) {
          const collapse = {};
          stage.$match.$or.forEach(element => {
            for (const key in element) {
              collapse[key] = element[key];
            }
          });
          stage.$match = collapse;
        }

        for (const field in stage.$match) {
          const value = stage.$match[field];
          const matchPatterns = [];
          Object.keys(ParseToPosgresComparator).forEach(cmp => {
            if (value[cmp]) {
              const pgComparator = ParseToPosgresComparator[cmp];
              matchPatterns.push(`$${index}:name ${pgComparator} $${index + 1}`);
              values.push(field, toPostgresValue(value[cmp]));
              index += 2;
            }
          });

          if (matchPatterns.length > 0) {
            patterns.push(`(${matchPatterns.join(' AND ')})`);
          }

          if (schema.fields[field] && schema.fields[field].type && matchPatterns.length === 0) {
            patterns.push(`$${index}:name = $${index + 1}`);
            values.push(field, value);
            index += 2;
          }
        }

        wherePattern = patterns.length > 0 ? `WHERE ${patterns.join(` ${orOrAnd} `)}` : '';
      }

      if (stage.$limit) {
        limitPattern = `LIMIT $${index}`;
        values.push(stage.$limit);
        index += 1;
      }

      if (stage.$skip) {
        skipPattern = `OFFSET $${index}`;
        values.push(stage.$skip);
        index += 1;
      }

      if (stage.$sort) {
        const sort = stage.$sort;
        const keys = Object.keys(sort);
        const sorting = keys.map(key => {
          const transformer = sort[key] === 1 ? 'ASC' : 'DESC';
          const order = `$${index}:name ${transformer}`;
          index += 1;
          return order;
        }).join();
        values.push(...keys);
        sortPattern = sort !== undefined && sorting.length > 0 ? `ORDER BY ${sorting}` : '';
      }
    }

    const qs = `SELECT ${columns.join()} FROM $1:name ${wherePattern} ${sortPattern} ${limitPattern} ${skipPattern} ${groupPattern}`;
    debug(qs, values);
    return this._client.map(qs, values, a => this.postgresObjectToParseObject(className, a, schema)).then(results => {
      results.forEach(result => {
        if (!result.hasOwnProperty('objectId')) {
          result.objectId = null;
        }

        if (groupValues) {
          result.objectId = {};

          for (const key in groupValues) {
            result.objectId[key] = result[key];
            delete result[key];
          }
        }

        if (countField) {
          result[countField] = parseInt(result[countField], 10);
        }
      });
      return results;
    });
  }

  performInitialization({
    VolatileClassesSchemas
  }) {
    // TODO: This method needs to be rewritten to make proper use of connections (@vitaly-t)
    debug('performInitialization');
    const promises = VolatileClassesSchemas.map(schema => {
      return this.createTable(schema.className, schema).catch(err => {
        if (err.code === PostgresDuplicateRelationError || err.code === _node.default.Error.INVALID_CLASS_NAME) {
          return Promise.resolve();
        }

        throw err;
      }).then(() => this.schemaUpgrade(schema.className, schema));
    });
    return Promise.all(promises).then(() => {
      return this._client.tx('perform-initialization', t => {
        return t.batch([t.none(_sql.default.misc.jsonObjectSetKeys), t.none(_sql.default.array.add), t.none(_sql.default.array.addUnique), t.none(_sql.default.array.remove), t.none(_sql.default.array.containsAll), t.none(_sql.default.array.containsAllRegex), t.none(_sql.default.array.contains)]);
      });
    }).then(data => {
      debug(`initializationDone in ${data.duration}`);
    }).catch(error => {
      /* eslint-disable no-console */
      console.error(error);
    });
  }

  createIndexes(className, indexes, conn) {
    return (conn || this._client).tx(t => t.batch(indexes.map(i => {
      return t.none('CREATE INDEX $1:name ON $2:name ($3:name)', [i.name, className, i.key]);
    })));
  }

  createIndexesIfNeeded(className, fieldName, type, conn) {
    return (conn || this._client).none('CREATE INDEX $1:name ON $2:name ($3:name)', [fieldName, className, type]);
  }

  dropIndexes(className, indexes, conn) {
    const queries = indexes.map(i => ({
      query: 'DROP INDEX $1:name',
      values: i
    }));
    return (conn || this._client).tx(t => t.none(this._pgp.helpers.concat(queries)));
  }

  getIndexes(className) {
    const qs = 'SELECT * FROM pg_indexes WHERE tablename = ${className}';
    return this._client.any(qs, {
      className
    });
  }

  updateSchemaWithIndexes() {
    return Promise.resolve();
  }

}

exports.PostgresStorageAdapter = PostgresStorageAdapter;

function convertPolygonToSQL(polygon) {
  if (polygon.length < 3) {
    throw new _node.default.Error(_node.default.Error.INVALID_JSON, `Polygon must have at least 3 values`);
  }

  if (polygon[0][0] !== polygon[polygon.length - 1][0] || polygon[0][1] !== polygon[polygon.length - 1][1]) {
    polygon.push(polygon[0]);
  }

  const unique = polygon.filter((item, index, ar) => {
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
    throw new _node.default.Error(_node.default.Error.INTERNAL_SERVER_ERROR, 'GeoJSON: Loop must have at least 3 different vertices');
  }

  const points = polygon.map(point => {
    _node.default.GeoPoint._validate(parseFloat(point[1]), parseFloat(point[0]));

    return `(${point[1]}, ${point[0]})`;
  }).join(', ');
  return `(${points})`;
}

function removeWhiteSpace(regex) {
  if (!regex.endsWith('\n')) {
    regex += '\n';
  } // remove non escaped comments


  return regex.replace(/([^\\])#.*\n/gim, '$1') // remove lines starting with a comment
  .replace(/^#.*\n/gim, '') // remove non escaped whitespace
  .replace(/([^\\])\s+/gim, '$1') // remove whitespace at the beginning of a line
  .replace(/^\s+/, '').trim();
}

function processRegexPattern(s) {
  if (s && s.startsWith('^')) {
    // regex for startsWith
    return '^' + literalizeRegexPart(s.slice(1));
  } else if (s && s.endsWith('$')) {
    // regex for endsWith
    return literalizeRegexPart(s.slice(0, s.length - 1)) + '$';
  } // regex for contains


  return literalizeRegexPart(s);
}

function isStartsWithRegex(value) {
  if (!value || typeof value !== 'string' || !value.startsWith('^')) {
    return false;
  }

  const matches = value.match(/\^\\Q.*\\E/);
  return !!matches;
}

function isAllValuesRegexOrNone(values) {
  if (!values || !Array.isArray(values) || values.length === 0) {
    return true;
  }

  const firstValuesIsRegex = isStartsWithRegex(values[0].$regex);

  if (values.length === 1) {
    return firstValuesIsRegex;
  }

  for (let i = 1, length = values.length; i < length; ++i) {
    if (firstValuesIsRegex !== isStartsWithRegex(values[i].$regex)) {
      return false;
    }
  }

  return true;
}

function isAnyValueRegexStartsWith(values) {
  return values.some(function (value) {
    return isStartsWithRegex(value.$regex);
  });
}

function createLiteralRegex(remaining) {
  return remaining.split('').map(c => {
    const regex = (0, _xregexp.XRegExp)('[0-9 ]|\\p{L}'); // Support all unicode letter chars

    if (c.match(regex) !== null) {
      // don't escape alphanumeric characters
      return c;
    } // escape everything else (single quotes with single quotes, everything else with a backslash)


    return c === `'` ? `''` : `\\${c}`;
  }).join('');
}

function literalizeRegexPart(s) {
  const matcher1 = /\\Q((?!\\E).*)\\E$/;
  const result1 = s.match(matcher1);

  if (result1 && result1.length > 1 && result1.index > -1) {
    // process regex that has a beginning and an end specified for the literal text
    const prefix = s.substr(0, result1.index);
    const remaining = result1[1];
    return literalizeRegexPart(prefix) + createLiteralRegex(remaining);
  } // process regex that has a beginning specified for the literal text


  const matcher2 = /\\Q((?!\\E).*)$/;
  const result2 = s.match(matcher2);

  if (result2 && result2.length > 1 && result2.index > -1) {
    const prefix = s.substr(0, result2.index);
    const remaining = result2[1];
    return literalizeRegexPart(prefix) + createLiteralRegex(remaining);
  } // remove all instances of \Q and \E from the remaining text & escape single quotes


  return s.replace(/([^\\])(\\E)/, '$1').replace(/([^\\])(\\Q)/, '$1').replace(/^\\E/, '').replace(/^\\Q/, '').replace(/([^'])'/, `$1''`).replace(/^'([^'])/, `''$1`);
}

var GeoPointCoder = {
  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'GeoPoint';
  }

};
var _default = PostgresStorageAdapter;
exports.default = _default;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9BZGFwdGVycy9TdG9yYWdlL1Bvc3RncmVzL1Bvc3RncmVzU3RvcmFnZUFkYXB0ZXIuanMiXSwibmFtZXMiOlsiUG9zdGdyZXNSZWxhdGlvbkRvZXNOb3RFeGlzdEVycm9yIiwiUG9zdGdyZXNEdXBsaWNhdGVSZWxhdGlvbkVycm9yIiwiUG9zdGdyZXNEdXBsaWNhdGVDb2x1bW5FcnJvciIsIlBvc3RncmVzTWlzc2luZ0NvbHVtbkVycm9yIiwiUG9zdGdyZXNEdXBsaWNhdGVPYmplY3RFcnJvciIsIlBvc3RncmVzVW5pcXVlSW5kZXhWaW9sYXRpb25FcnJvciIsIlBvc3RncmVzVHJhbnNhY3Rpb25BYm9ydGVkRXJyb3IiLCJsb2dnZXIiLCJyZXF1aXJlIiwiZGVidWciLCJhcmdzIiwiYXJndW1lbnRzIiwiY29uY2F0Iiwic2xpY2UiLCJsZW5ndGgiLCJsb2ciLCJnZXRMb2dnZXIiLCJhcHBseSIsInBhcnNlVHlwZVRvUG9zdGdyZXNUeXBlIiwidHlwZSIsImNvbnRlbnRzIiwiSlNPTiIsInN0cmluZ2lmeSIsIlBhcnNlVG9Qb3NncmVzQ29tcGFyYXRvciIsIiRndCIsIiRsdCIsIiRndGUiLCIkbHRlIiwibW9uZ29BZ2dyZWdhdGVUb1Bvc3RncmVzIiwiJGRheU9mTW9udGgiLCIkZGF5T2ZXZWVrIiwiJGRheU9mWWVhciIsIiRpc29EYXlPZldlZWsiLCIkaXNvV2Vla1llYXIiLCIkaG91ciIsIiRtaW51dGUiLCIkc2Vjb25kIiwiJG1pbGxpc2Vjb25kIiwiJG1vbnRoIiwiJHdlZWsiLCIkeWVhciIsInRvUG9zdGdyZXNWYWx1ZSIsInZhbHVlIiwiX190eXBlIiwiaXNvIiwibmFtZSIsInRyYW5zZm9ybVZhbHVlIiwib2JqZWN0SWQiLCJlbXB0eUNMUFMiLCJPYmplY3QiLCJmcmVlemUiLCJmaW5kIiwiZ2V0IiwiY3JlYXRlIiwidXBkYXRlIiwiZGVsZXRlIiwiYWRkRmllbGQiLCJwcm90ZWN0ZWRGaWVsZHMiLCJkZWZhdWx0Q0xQUyIsInRvUGFyc2VTY2hlbWEiLCJzY2hlbWEiLCJjbGFzc05hbWUiLCJmaWVsZHMiLCJfaGFzaGVkX3Bhc3N3b3JkIiwiX3dwZXJtIiwiX3JwZXJtIiwiY2xwcyIsImNsYXNzTGV2ZWxQZXJtaXNzaW9ucyIsImluZGV4ZXMiLCJ0b1Bvc3RncmVzU2NoZW1hIiwiX3Bhc3N3b3JkX2hpc3RvcnkiLCJoYW5kbGVEb3RGaWVsZHMiLCJvYmplY3QiLCJrZXlzIiwiZm9yRWFjaCIsImZpZWxkTmFtZSIsImluZGV4T2YiLCJjb21wb25lbnRzIiwic3BsaXQiLCJmaXJzdCIsInNoaWZ0IiwiY3VycmVudE9iaiIsIm5leHQiLCJfX29wIiwidW5kZWZpbmVkIiwidHJhbnNmb3JtRG90RmllbGRUb0NvbXBvbmVudHMiLCJtYXAiLCJjbXB0IiwiaW5kZXgiLCJ0cmFuc2Zvcm1Eb3RGaWVsZCIsImpvaW4iLCJ0cmFuc2Zvcm1BZ2dyZWdhdGVGaWVsZCIsInN1YnN0ciIsInZhbGlkYXRlS2V5cyIsImtleSIsImluY2x1ZGVzIiwiUGFyc2UiLCJFcnJvciIsIklOVkFMSURfTkVTVEVEX0tFWSIsImpvaW5UYWJsZXNGb3JTY2hlbWEiLCJsaXN0IiwiZmllbGQiLCJwdXNoIiwiYnVpbGRXaGVyZUNsYXVzZSIsInF1ZXJ5IiwicGF0dGVybnMiLCJ2YWx1ZXMiLCJzb3J0cyIsImlzQXJyYXlGaWVsZCIsImluaXRpYWxQYXR0ZXJuc0xlbmd0aCIsImZpZWxkVmFsdWUiLCIkZXhpc3RzIiwiJGluIiwiaW5QYXR0ZXJucyIsImxpc3RFbGVtIiwiSU5WQUxJRF9KU09OIiwiJHJlZ2V4IiwiTUFYX0lOVF9QTFVTX09ORSIsImNsYXVzZXMiLCJjbGF1c2VWYWx1ZXMiLCJzdWJRdWVyeSIsImNsYXVzZSIsInBhdHRlcm4iLCJvck9yQW5kIiwibm90IiwiJG5lIiwiJGVxIiwiaXNJbk9yTmluIiwiQXJyYXkiLCJpc0FycmF5IiwiJG5pbiIsImFsbG93TnVsbCIsImxpc3RJbmRleCIsImNyZWF0ZUNvbnN0cmFpbnQiLCJiYXNlQXJyYXkiLCJub3RJbiIsIl8iLCJmbGF0TWFwIiwiZWx0IiwiJGFsbCIsImlzQW55VmFsdWVSZWdleFN0YXJ0c1dpdGgiLCJpc0FsbFZhbHVlc1JlZ2V4T3JOb25lIiwiaSIsInByb2Nlc3NSZWdleFBhdHRlcm4iLCJzdWJzdHJpbmciLCIkY29udGFpbmVkQnkiLCJhcnIiLCIkdGV4dCIsInNlYXJjaCIsIiRzZWFyY2giLCJsYW5ndWFnZSIsIiR0ZXJtIiwiJGxhbmd1YWdlIiwiJGNhc2VTZW5zaXRpdmUiLCIkZGlhY3JpdGljU2Vuc2l0aXZlIiwiJG5lYXJTcGhlcmUiLCJwb2ludCIsImRpc3RhbmNlIiwiJG1heERpc3RhbmNlIiwiZGlzdGFuY2VJbktNIiwibG9uZ2l0dWRlIiwibGF0aXR1ZGUiLCIkd2l0aGluIiwiJGJveCIsImJveCIsImxlZnQiLCJib3R0b20iLCJyaWdodCIsInRvcCIsIiRnZW9XaXRoaW4iLCIkY2VudGVyU3BoZXJlIiwiY2VudGVyU3BoZXJlIiwiR2VvUG9pbnQiLCJHZW9Qb2ludENvZGVyIiwiaXNWYWxpZEpTT04iLCJfdmFsaWRhdGUiLCJpc05hTiIsIiRwb2x5Z29uIiwicG9seWdvbiIsInBvaW50cyIsImNvb3JkaW5hdGVzIiwiJGdlb0ludGVyc2VjdHMiLCIkcG9pbnQiLCJyZWdleCIsIm9wZXJhdG9yIiwib3B0cyIsIiRvcHRpb25zIiwicmVtb3ZlV2hpdGVTcGFjZSIsImNvbnZlcnRQb2x5Z29uVG9TUUwiLCJjbXAiLCJwZ0NvbXBhcmF0b3IiLCJPUEVSQVRJT05fRk9SQklEREVOIiwiUG9zdGdyZXNTdG9yYWdlQWRhcHRlciIsImNvbnN0cnVjdG9yIiwidXJpIiwiY29sbGVjdGlvblByZWZpeCIsImRhdGFiYXNlT3B0aW9ucyIsIl9jb2xsZWN0aW9uUHJlZml4IiwiY2xpZW50IiwicGdwIiwiX2NsaWVudCIsIl9wZ3AiLCJjYW5Tb3J0T25Kb2luVGFibGVzIiwiaGFuZGxlU2h1dGRvd24iLCIkcG9vbCIsImVuZCIsIl9lbnN1cmVTY2hlbWFDb2xsZWN0aW9uRXhpc3RzIiwiY29ubiIsIm5vbmUiLCJjYXRjaCIsImVycm9yIiwiY29kZSIsImNsYXNzRXhpc3RzIiwib25lIiwiYSIsImV4aXN0cyIsInNldENsYXNzTGV2ZWxQZXJtaXNzaW9ucyIsIkNMUHMiLCJzZWxmIiwidGFzayIsInQiLCJzZXRJbmRleGVzV2l0aFNjaGVtYUZvcm1hdCIsInN1Ym1pdHRlZEluZGV4ZXMiLCJleGlzdGluZ0luZGV4ZXMiLCJQcm9taXNlIiwicmVzb2x2ZSIsIl9pZF8iLCJfaWQiLCJkZWxldGVkSW5kZXhlcyIsImluc2VydGVkSW5kZXhlcyIsIklOVkFMSURfUVVFUlkiLCJoYXNPd25Qcm9wZXJ0eSIsInR4IiwiY3JlYXRlSW5kZXhlcyIsImRyb3BJbmRleGVzIiwiY3JlYXRlQ2xhc3MiLCJxMSIsImNyZWF0ZVRhYmxlIiwicTIiLCJxMyIsImJhdGNoIiwidGhlbiIsImVyciIsImRhdGEiLCJyZXN1bHQiLCJkZXRhaWwiLCJEVVBMSUNBVEVfVkFMVUUiLCJ2YWx1ZXNBcnJheSIsInBhdHRlcm5zQXJyYXkiLCJhc3NpZ24iLCJfZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQiLCJfZW1haWxfdmVyaWZ5X3Rva2VuIiwiX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0IiwiX2ZhaWxlZF9sb2dpbl9jb3VudCIsIl9wZXJpc2hhYmxlX3Rva2VuIiwiX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCIsIl9wYXNzd29yZF9jaGFuZ2VkX2F0IiwicmVsYXRpb25zIiwicGFyc2VUeXBlIiwicXMiLCJqb2luVGFibGUiLCJzY2hlbWFVcGdyYWRlIiwiY29sdW1ucyIsImNvbHVtbl9uYW1lIiwibmV3Q29sdW1ucyIsImZpbHRlciIsIml0ZW0iLCJhZGRGaWVsZElmTm90RXhpc3RzIiwicG9zdGdyZXNUeXBlIiwiYW55IiwicGF0aCIsImRlbGV0ZUNsYXNzIiwib3BlcmF0aW9ucyIsImhlbHBlcnMiLCJkZWxldGVBbGxDbGFzc2VzIiwibm93IiwiRGF0ZSIsImdldFRpbWUiLCJyZXN1bHRzIiwiam9pbnMiLCJyZWR1Y2UiLCJjbGFzc2VzIiwicXVlcmllcyIsImRlbGV0ZUZpZWxkcyIsImZpZWxkTmFtZXMiLCJpZHgiLCJnZXRBbGxDbGFzc2VzIiwicm93IiwiZ2V0Q2xhc3MiLCJjcmVhdGVPYmplY3QiLCJjb2x1bW5zQXJyYXkiLCJnZW9Qb2ludHMiLCJhdXRoRGF0YU1hdGNoIiwibWF0Y2giLCJwcm92aWRlciIsInBvcCIsImluaXRpYWxWYWx1ZXMiLCJ2YWwiLCJ0ZXJtaW5hdGlvbiIsImdlb1BvaW50c0luamVjdHMiLCJsIiwiY29sdW1uc1BhdHRlcm4iLCJjb2wiLCJ2YWx1ZXNQYXR0ZXJuIiwib3BzIiwidW5kZXJseWluZ0Vycm9yIiwiY29uc3RyYWludCIsIm1hdGNoZXMiLCJ1c2VySW5mbyIsImR1cGxpY2F0ZWRfZmllbGQiLCJkZWxldGVPYmplY3RzQnlRdWVyeSIsIndoZXJlIiwiY291bnQiLCJPQkpFQ1RfTk9UX0ZPVU5EIiwiZmluZE9uZUFuZFVwZGF0ZSIsInVwZGF0ZU9iamVjdHNCeVF1ZXJ5IiwidXBkYXRlUGF0dGVybnMiLCJvcmlnaW5hbFVwZGF0ZSIsImRvdE5vdGF0aW9uT3B0aW9ucyIsImdlbmVyYXRlIiwianNvbmIiLCJsYXN0S2V5IiwiZmllbGROYW1lSW5kZXgiLCJzdHIiLCJhbW91bnQiLCJvYmplY3RzIiwia2V5c1RvSW5jcmVtZW50IiwiayIsImluY3JlbWVudFBhdHRlcm5zIiwiYyIsImtleXNUb0RlbGV0ZSIsImRlbGV0ZVBhdHRlcm5zIiwicCIsInVwZGF0ZU9iamVjdCIsImV4cGVjdGVkVHlwZSIsImJ1aWxkU1FMQXJyYXkiLCJlbGVtZW50Iiwic3FsIiwicmVqZWN0Iiwid2hlcmVDbGF1c2UiLCJ1cHNlcnRPbmVPYmplY3QiLCJjcmVhdGVWYWx1ZSIsInNraXAiLCJsaW1pdCIsInNvcnQiLCJoYXNMaW1pdCIsImhhc1NraXAiLCJ3aGVyZVBhdHRlcm4iLCJsaW1pdFBhdHRlcm4iLCJza2lwUGF0dGVybiIsInNvcnRQYXR0ZXJuIiwic29ydENvcHkiLCJzb3J0aW5nIiwidHJhbnNmb3JtS2V5IiwibWVtbyIsInBvc3RncmVzT2JqZWN0VG9QYXJzZU9iamVjdCIsInRhcmdldENsYXNzIiwieSIsIngiLCJjb29yZHMiLCJwYXJzZUZsb2F0IiwiY3JlYXRlZEF0IiwidG9JU09TdHJpbmciLCJ1cGRhdGVkQXQiLCJleHBpcmVzQXQiLCJlbnN1cmVVbmlxdWVuZXNzIiwiY29uc3RyYWludE5hbWUiLCJjb25zdHJhaW50UGF0dGVybnMiLCJtZXNzYWdlIiwiZGlzdGluY3QiLCJjb2x1bW4iLCJpc05lc3RlZCIsImlzUG9pbnRlckZpZWxkIiwidHJhbnNmb3JtZXIiLCJjaGlsZCIsImFnZ3JlZ2F0ZSIsInBpcGVsaW5lIiwiY291bnRGaWVsZCIsImdyb3VwVmFsdWVzIiwiZ3JvdXBQYXR0ZXJuIiwic3RhZ2UiLCIkZ3JvdXAiLCJncm91cEJ5RmllbGRzIiwiYWxpYXMiLCJvcGVyYXRpb24iLCJzb3VyY2UiLCIkc3VtIiwiJG1heCIsIiRtaW4iLCIkYXZnIiwiJHByb2plY3QiLCIkbWF0Y2giLCIkb3IiLCJjb2xsYXBzZSIsIm1hdGNoUGF0dGVybnMiLCIkbGltaXQiLCIkc2tpcCIsIiRzb3J0Iiwib3JkZXIiLCJwYXJzZUludCIsInBlcmZvcm1Jbml0aWFsaXphdGlvbiIsIlZvbGF0aWxlQ2xhc3Nlc1NjaGVtYXMiLCJwcm9taXNlcyIsIklOVkFMSURfQ0xBU1NfTkFNRSIsImFsbCIsIm1pc2MiLCJqc29uT2JqZWN0U2V0S2V5cyIsImFycmF5IiwiYWRkIiwiYWRkVW5pcXVlIiwicmVtb3ZlIiwiY29udGFpbnNBbGwiLCJjb250YWluc0FsbFJlZ2V4IiwiY29udGFpbnMiLCJkdXJhdGlvbiIsImNvbnNvbGUiLCJjcmVhdGVJbmRleGVzSWZOZWVkZWQiLCJnZXRJbmRleGVzIiwidXBkYXRlU2NoZW1hV2l0aEluZGV4ZXMiLCJ1bmlxdWUiLCJhciIsImZvdW5kSW5kZXgiLCJwdCIsIklOVEVSTkFMX1NFUlZFUl9FUlJPUiIsImVuZHNXaXRoIiwicmVwbGFjZSIsInRyaW0iLCJzIiwic3RhcnRzV2l0aCIsImxpdGVyYWxpemVSZWdleFBhcnQiLCJpc1N0YXJ0c1dpdGhSZWdleCIsImZpcnN0VmFsdWVzSXNSZWdleCIsInNvbWUiLCJjcmVhdGVMaXRlcmFsUmVnZXgiLCJyZW1haW5pbmciLCJtYXRjaGVyMSIsInJlc3VsdDEiLCJwcmVmaXgiLCJtYXRjaGVyMiIsInJlc3VsdDIiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFDQTs7QUFFQTs7QUFFQTs7QUFDQTs7QUFDQTs7QUFpQkE7Ozs7Ozs7O0FBZkEsTUFBTUEsaUNBQWlDLEdBQUcsT0FBMUM7QUFDQSxNQUFNQyw4QkFBOEIsR0FBRyxPQUF2QztBQUNBLE1BQU1DLDRCQUE0QixHQUFHLE9BQXJDO0FBQ0EsTUFBTUMsMEJBQTBCLEdBQUcsT0FBbkM7QUFDQSxNQUFNQyw0QkFBNEIsR0FBRyxPQUFyQztBQUNBLE1BQU1DLGlDQUFpQyxHQUFHLE9BQTFDO0FBQ0EsTUFBTUMsK0JBQStCLEdBQUcsT0FBeEM7O0FBQ0EsTUFBTUMsTUFBTSxHQUFHQyxPQUFPLENBQUMsaUJBQUQsQ0FBdEI7O0FBRUEsTUFBTUMsS0FBSyxHQUFHLFVBQVMsR0FBR0MsSUFBWixFQUF1QjtBQUNuQ0EsRUFBQUEsSUFBSSxHQUFHLENBQUMsU0FBU0MsU0FBUyxDQUFDLENBQUQsQ0FBbkIsRUFBd0JDLE1BQXhCLENBQStCRixJQUFJLENBQUNHLEtBQUwsQ0FBVyxDQUFYLEVBQWNILElBQUksQ0FBQ0ksTUFBbkIsQ0FBL0IsQ0FBUDtBQUNBLFFBQU1DLEdBQUcsR0FBR1IsTUFBTSxDQUFDUyxTQUFQLEVBQVo7QUFDQUQsRUFBQUEsR0FBRyxDQUFDTixLQUFKLENBQVVRLEtBQVYsQ0FBZ0JGLEdBQWhCLEVBQXFCTCxJQUFyQjtBQUNELENBSkQ7O0FBU0EsTUFBTVEsdUJBQXVCLEdBQUdDLElBQUksSUFBSTtBQUN0QyxVQUFRQSxJQUFJLENBQUNBLElBQWI7QUFDRSxTQUFLLFFBQUw7QUFDRSxhQUFPLE1BQVA7O0FBQ0YsU0FBSyxNQUFMO0FBQ0UsYUFB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Q0FDTEYsT0FESSxDQUNJLGNBREosRUFDb0IsSUFEcEIsRUFFSkEsT0FGSSxDQUVJLGNBRkosRUFFb0IsSUFGcEIsRUFHSkEsT0FISSxDQUdJLE1BSEosRUFHWSxFQUhaLEVBSUpBLE9BSkksQ0FJSSxNQUpKLEVBSVksRUFKWixFQUtKQSxPQUxJLENBS0ksU0FMSixFQUtnQixNQUxoQixFQU1KQSxPQU5JLENBTUksVUFOSixFQU1pQixNQU5qQixDQUFQO0FBT0Q7O0FBRUQsSUFBSTVQLGFBQWEsR0FBRztBQUNsQkMsRUFBQUEsV0FBVyxDQUFDcEksS0FBRCxFQUFRO0FBQ2pCLFdBQ0UsT0FBT0EsS0FBUCxLQUFpQixRQUFqQixJQUE2QkEsS0FBSyxLQUFLLElBQXZDLElBQStDQSxLQUFLLENBQUNDLE1BQU4sS0FBaUIsVUFEbEU7QUFHRDs7QUFMaUIsQ0FBcEI7ZUFRZXFKLHNCIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQGZsb3dcbmltcG9ydCB7IGNyZWF0ZUNsaWVudCB9IGZyb20gJy4vUG9zdGdyZXNDbGllbnQnO1xuLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG5pbXBvcnQgUGFyc2UgZnJvbSAncGFyc2Uvbm9kZSc7XG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmltcG9ydCBfIGZyb20gJ2xvZGFzaCc7XG5pbXBvcnQgc3FsIGZyb20gJy4vc3FsJztcbmltcG9ydCB7IFhSZWdFeHAgfSBmcm9tICd4cmVnZXhwJztcblxuY29uc3QgUG9zdGdyZXNSZWxhdGlvbkRvZXNOb3RFeGlzdEVycm9yID0gJzQyUDAxJztcbmNvbnN0IFBvc3RncmVzRHVwbGljYXRlUmVsYXRpb25FcnJvciA9ICc0MlAwNyc7XG5jb25zdCBQb3N0Z3Jlc0R1cGxpY2F0ZUNvbHVtbkVycm9yID0gJzQyNzAxJztcbmNvbnN0IFBvc3RncmVzTWlzc2luZ0NvbHVtbkVycm9yID0gJzQyNzAzJztcbmNvbnN0IFBvc3RncmVzRHVwbGljYXRlT2JqZWN0RXJyb3IgPSAnNDI3MTAnO1xuY29uc3QgUG9zdGdyZXNVbmlxdWVJbmRleFZpb2xhdGlvbkVycm9yID0gJzIzNTA1JztcbmNvbnN0IFBvc3RncmVzVHJhbnNhY3Rpb25BYm9ydGVkRXJyb3IgPSAnMjVQMDInO1xuY29uc3QgbG9nZ2VyID0gcmVxdWlyZSgnLi4vLi4vLi4vbG9nZ2VyJyk7XG5cbmNvbnN0IGRlYnVnID0gZnVuY3Rpb24oLi4uYXJnczogYW55KSB7XG4gIGFyZ3MgPSBbJ1BHOiAnICsgYXJndW1lbnRzWzBdXS5jb25jYXQoYXJncy5zbGljZSgxLCBhcmdzLmxlbmd0aCkpO1xuICBjb25zdCBsb2cgPSBsb2dnZXIuZ2V0TG9nZ2VyKCk7XG4gIGxvZy5kZWJ1Zy5hcHBseShsb2csIGFyZ3MpO1xufTtcblxuaW1wb3J0IHsgU3RvcmFnZUFkYXB0ZXIgfSBmcm9tICcuLi9TdG9yYWdlQWRhcHRlcic7XG5pbXBvcnQgdHlwZSB7IFNjaGVtYVR5cGUsIFF1ZXJ5VHlwZSwgUXVlcnlPcHRpb25zIH0gZnJvbSAnLi4vU3RvcmFnZUFkYXB0ZXInO1xuXG5jb25zdCBwYXJzZVR5cGVUb1Bvc3RncmVzVHlwZSA9IHR5cGUgPT4ge1xuICBzd2l0Y2ggKHR5cGUudHlwZSkge1xuICAgIGNhc2UgJ1N0cmluZyc6XG4gICAgICByZXR1cm4gJ3RleHQnO1xuICAgIGNhc2UgJ0RhdGUnOlxuICAgICAgcmV0dXJuICd0aW1lc3RhbXAgd2l0aCB0aW1lIHpvbmUnO1xuICAgIGNhc2UgJ09iamVjdCc6XG4gICAgICByZXR1cm4gJ2pzb25iJztcbiAgICBjYXNlICdGaWxlJzpcbiAgICAgIHJldHVybiAndGV4dCc7XG4gICAgY2FzZSAnQm9vbGVhbic6XG4gICAgICByZXR1cm4gJ2Jvb2xlYW4nO1xuICAgIGNhc2UgJ1BvaW50ZXInOlxuICAgICAgcmV0dXJuICdjaGFyKDEwKSc7XG4gICAgY2FzZSAnTnVtYmVyJzpcbiAgICAgIHJldHVybiAnZG91YmxlIHByZWNpc2lvbic7XG4gICAgY2FzZSAnR2VvUG9pbnQnOlxuICAgICAgcmV0dXJuICdwb2ludCc7XG4gICAgY2FzZSAnQnl0ZXMnOlxuICAgICAgcmV0dXJuICdqc29uYic7XG4gICAgY2FzZSAnUG9seWdvbic6XG4gICAgICByZXR1cm4gJ3BvbHlnb24nO1xuICAgIGNhc2UgJ0FycmF5JzpcbiAgICAgIGlmICh0eXBlLmNvbnRlbnRzICYmIHR5cGUuY29udGVudHMudHlwZSA9PT0gJ1N0cmluZycpIHtcbiAgICAgICAgcmV0dXJuICd0ZXh0W10nO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuICdqc29uYic7XG4gICAgICB9XG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IGBubyB0eXBlIGZvciAke0pTT04uc3RyaW5naWZ5KHR5cGUpfSB5ZXRgO1xuICB9XG59O1xuXG5jb25zdCBQYXJzZVRvUG9zZ3Jlc0NvbXBhcmF0b3IgPSB7XG4gICRndDogJz4nLFxuICAkbHQ6ICc8JyxcbiAgJGd0ZTogJz49JyxcbiAgJGx0ZTogJzw9Jyxcbn07XG5cbmNvbnN0IG1vbmdvQWdncmVnYXRlVG9Qb3N0Z3JlcyA9IHtcbiAgJGRheU9mTW9udGg6ICdEQVknLFxuICAkZGF5T2ZXZWVrOiAnRE9XJyxcbiAgJGRheU9mWWVhcjogJ0RPWScsXG4gICRpc29EYXlPZldlZWs6ICdJU09ET1cnLFxuICAkaXNvV2Vla1llYXI6ICdJU09ZRUFSJyxcbiAgJGhvdXI6ICdIT1VSJyxcbiAgJG1pbnV0ZTogJ01JTlVURScsXG4gICRzZWNvbmQ6ICdTRUNPTkQnLFxuICAkbWlsbGlzZWNvbmQ6ICdNSUxMSVNFQ09ORFMnLFxuICAkbW9udGg6ICdNT05USCcsXG4gICR3ZWVrOiAnV0VFSycsXG4gICR5ZWFyOiAnWUVBUicsXG59O1xuXG5jb25zdCB0b1Bvc3RncmVzVmFsdWUgPSB2YWx1ZSA9PiB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7XG4gICAgaWYgKHZhbHVlLl9fdHlwZSA9PT0gJ0RhdGUnKSB7XG4gICAgICByZXR1cm4gdmFsdWUuaXNvO1xuICAgIH1cbiAgICBpZiAodmFsdWUuX190eXBlID09PSAnRmlsZScpIHtcbiAgICAgIHJldHVybiB2YWx1ZS5uYW1lO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdmFsdWU7XG59O1xuXG5jb25zdCB0cmFuc2Zvcm1WYWx1ZSA9IHZhbHVlID0+IHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgdmFsdWUuX190eXBlID09PSAnUG9pbnRlcicpIHtcbiAgICByZXR1cm4gdmFsdWUub2JqZWN0SWQ7XG4gIH1cbiAgcmV0dXJuIHZhbHVlO1xufTtcblxuLy8gRHVwbGljYXRlIGZyb20gdGhlbiBtb25nbyBhZGFwdGVyLi4uXG5jb25zdCBlbXB0eUNMUFMgPSBPYmplY3QuZnJlZXplKHtcbiAgZmluZDoge30sXG4gIGdldDoge30sXG4gIGNyZWF0ZToge30sXG4gIHVwZGF0ZToge30sXG4gIGRlbGV0ZToge30sXG4gIGFkZEZpZWxkOiB7fSxcbiAgcHJvdGVjdGVkRmllbGRzOiB7fSxcbn0pO1xuXG5jb25zdCBkZWZhdWx0Q0xQUyA9IE9iamVjdC5mcmVlemUoe1xuICBmaW5kOiB7ICcqJzogdHJ1ZSB9LFxuICBnZXQ6IHsgJyonOiB0cnVlIH0sXG4gIGNyZWF0ZTogeyAnKic6IHRydWUgfSxcbiAgdXBkYXRlOiB7ICcqJzogdHJ1ZSB9LFxuICBkZWxldGU6IHsgJyonOiB0cnVlIH0sXG4gIGFkZEZpZWxkOiB7ICcqJzogdHJ1ZSB9LFxuICBwcm90ZWN0ZWRGaWVsZHM6IHsgJyonOiBbXSB9LFxufSk7XG5cbmNvbnN0IHRvUGFyc2VTY2hlbWEgPSBzY2hlbWEgPT4ge1xuICBpZiAoc2NoZW1hLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJykge1xuICAgIGRlbGV0ZSBzY2hlbWEuZmllbGRzLl9oYXNoZWRfcGFzc3dvcmQ7XG4gIH1cbiAgaWYgKHNjaGVtYS5maWVsZHMpIHtcbiAgICBkZWxldGUgc2NoZW1hLmZpZWxkcy5fd3Blcm07XG4gICAgZGVsZXRlIHNjaGVtYS5maWVsZHMuX3JwZXJtO1xuICB9XG4gIGxldCBjbHBzID0gZGVmYXVsdENMUFM7XG4gIGlmIChzY2hlbWEuY2xhc3NMZXZlbFBlcm1pc3Npb25zKSB7XG4gICAgY2xwcyA9IHsgLi4uZW1wdHlDTFBTLCAuLi5zY2hlbWEuY2xhc3NMZXZlbFBlcm1pc3Npb25zIH07XG4gIH1cbiAgbGV0IGluZGV4ZXMgPSB7fTtcbiAgaWYgKHNjaGVtYS5pbmRleGVzKSB7XG4gICAgaW5kZXhlcyA9IHsgLi4uc2NoZW1hLmluZGV4ZXMgfTtcbiAgfVxuICByZXR1cm4ge1xuICAgIGNsYXNzTmFtZTogc2NoZW1hLmNsYXNzTmFtZSxcbiAgICBmaWVsZHM6IHNjaGVtYS5maWVsZHMsXG4gICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiBjbHBzLFxuICAgIGluZGV4ZXMsXG4gIH07XG59O1xuXG5jb25zdCB0b1Bvc3RncmVzU2NoZW1hID0gc2NoZW1hID0+IHtcbiAgaWYgKCFzY2hlbWEpIHtcbiAgICByZXR1cm4gc2NoZW1hO1xuICB9XG4gIHNjaGVtYS5maWVsZHMgPSBzY2hlbWEuZmllbGRzIHx8IHt9O1xuICBzY2hlbWEuZmllbGRzLl93cGVybSA9IHsgdHlwZTogJ0FycmF5JywgY29udGVudHM6IHsgdHlwZTogJ1N0cmluZycgfSB9O1xuICBzY2hlbWEuZmllbGRzLl9ycGVybSA9IHsgdHlwZTogJ0FycmF5JywgY29udGVudHM6IHsgdHlwZTogJ1N0cmluZycgfSB9O1xuICBpZiAoc2NoZW1hLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJykge1xuICAgIHNjaGVtYS5maWVsZHMuX2hhc2hlZF9wYXNzd29yZCA9IHsgdHlwZTogJ1N0cmluZycgfTtcbiAgICBzY2hlbWEuZmllbGRzLl9wYXNzd29yZF9oaXN0b3J5ID0geyB0eXBlOiAnQXJyYXknIH07XG4gIH1cbiAgcmV0dXJuIHNjaGVtYTtcbn07XG5cbmNvbnN0IGhhbmRsZURvdEZpZWxkcyA9IG9iamVjdCA9PiB7XG4gIE9iamVjdC5rZXlzKG9iamVjdCkuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgIGlmIChmaWVsZE5hbWUuaW5kZXhPZignLicpID4gLTEpIHtcbiAgICAgIGNvbnN0IGNvbXBvbmVudHMgPSBmaWVsZE5hbWUuc3BsaXQoJy4nKTtcbiAgICAgIGNvbnN0IGZpcnN0ID0gY29tcG9uZW50cy5zaGlmdCgpO1xuICAgICAgb2JqZWN0W2ZpcnN0XSA9IG9iamVjdFtmaXJzdF0gfHwge307XG4gICAgICBsZXQgY3VycmVudE9iaiA9IG9iamVjdFtmaXJzdF07XG4gICAgICBsZXQgbmV4dDtcbiAgICAgIGxldCB2YWx1ZSA9IG9iamVjdFtmaWVsZE5hbWVdO1xuICAgICAgaWYgKHZhbHVlICYmIHZhbHVlLl9fb3AgPT09ICdEZWxldGUnKSB7XG4gICAgICAgIHZhbHVlID0gdW5kZWZpbmVkO1xuICAgICAgfVxuICAgICAgLyogZXNsaW50LWRpc2FibGUgbm8tY29uZC1hc3NpZ24gKi9cbiAgICAgIHdoaWxlICgobmV4dCA9IGNvbXBvbmVudHMuc2hpZnQoKSkpIHtcbiAgICAgICAgLyogZXNsaW50LWVuYWJsZSBuby1jb25kLWFzc2lnbiAqL1xuICAgICAgICBjdXJyZW50T2JqW25leHRdID0gY3VycmVudE9ialtuZXh0XSB8fCB7fTtcbiAgICAgICAgaWYgKGNvbXBvbmVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgY3VycmVudE9ialtuZXh0XSA9IHZhbHVlO1xuICAgICAgICB9XG4gICAgICAgIGN1cnJlbnRPYmogPSBjdXJyZW50T2JqW25leHRdO1xuICAgICAgfVxuICAgICAgZGVsZXRlIG9iamVjdFtmaWVsZE5hbWVdO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiBvYmplY3Q7XG59O1xuXG5jb25zdCB0cmFuc2Zvcm1Eb3RGaWVsZFRvQ29tcG9uZW50cyA9IGZpZWxkTmFtZSA9PiB7XG4gIHJldHVybiBmaWVsZE5hbWUuc3BsaXQoJy4nKS5tYXAoKGNtcHQsIGluZGV4KSA9PiB7XG4gICAgaWYgKGluZGV4ID09PSAwKSB7XG4gICAgICByZXR1cm4gYFwiJHtjbXB0fVwiYDtcbiAgICB9XG4gICAgcmV0dXJuIGAnJHtjbXB0fSdgO1xuICB9KTtcbn07XG5cbmNvbnN0IHRyYW5zZm9ybURvdEZpZWxkID0gZmllbGROYW1lID0+IHtcbiAgaWYgKGZpZWxkTmFtZS5pbmRleE9mKCcuJykgPT09IC0xKSB7XG4gICAgcmV0dXJuIGBcIiR7ZmllbGROYW1lfVwiYDtcbiAgfVxuICBjb25zdCBjb21wb25lbnRzID0gdHJhbnNmb3JtRG90RmllbGRUb0NvbXBvbmVudHMoZmllbGROYW1lKTtcbiAgbGV0IG5hbWUgPSBjb21wb25lbnRzLnNsaWNlKDAsIGNvbXBvbmVudHMubGVuZ3RoIC0gMSkuam9pbignLT4nKTtcbiAgbmFtZSArPSAnLT4+JyArIGNvbXBvbmVudHNbY29tcG9uZW50cy5sZW5ndGggLSAxXTtcbiAgcmV0dXJuIG5hbWU7XG59O1xuXG5jb25zdCB0cmFuc2Zvcm1BZ2dyZWdhdGVGaWVsZCA9IGZpZWxkTmFtZSA9PiB7XG4gIGlmICh0eXBlb2YgZmllbGROYW1lICE9PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBmaWVsZE5hbWU7XG4gIH1cbiAgaWYgKGZpZWxkTmFtZSA9PT0gJyRfY3JlYXRlZF9hdCcpIHtcbiAgICByZXR1cm4gJ2NyZWF0ZWRBdCc7XG4gIH1cbiAgaWYgKGZpZWxkTmFtZSA9PT0gJyRfdXBkYXRlZF9hdCcpIHtcbiAgICByZXR1cm4gJ3VwZGF0ZWRBdCc7XG4gIH1cbiAgcmV0dXJuIGZpZWxkTmFtZS5zdWJzdHIoMSk7XG59O1xuXG5jb25zdCB2YWxpZGF0ZUtleXMgPSBvYmplY3QgPT4ge1xuICBpZiAodHlwZW9mIG9iamVjdCA9PSAnb2JqZWN0Jykge1xuICAgIGZvciAoY29uc3Qga2V5IGluIG9iamVjdCkge1xuICAgICAgaWYgKHR5cGVvZiBvYmplY3Rba2V5XSA9PSAnb2JqZWN0Jykge1xuICAgICAgICB2YWxpZGF0ZUtleXMob2JqZWN0W2tleV0pO1xuICAgICAgfVxuXG4gICAgICBpZiAoa2V5LmluY2x1ZGVzKCckJykgfHwga2V5LmluY2x1ZGVzKCcuJykpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfTkVTVEVEX0tFWSxcbiAgICAgICAgICBcIk5lc3RlZCBrZXlzIHNob3VsZCBub3QgY29udGFpbiB0aGUgJyQnIG9yICcuJyBjaGFyYWN0ZXJzXCJcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cbi8vIFJldHVybnMgdGhlIGxpc3Qgb2Ygam9pbiB0YWJsZXMgb24gYSBzY2hlbWFcbmNvbnN0IGpvaW5UYWJsZXNGb3JTY2hlbWEgPSBzY2hlbWEgPT4ge1xuICBjb25zdCBsaXN0ID0gW107XG4gIGlmIChzY2hlbWEpIHtcbiAgICBPYmplY3Qua2V5cyhzY2hlbWEuZmllbGRzKS5mb3JFYWNoKGZpZWxkID0+IHtcbiAgICAgIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkXS50eXBlID09PSAnUmVsYXRpb24nKSB7XG4gICAgICAgIGxpc3QucHVzaChgX0pvaW46JHtmaWVsZH06JHtzY2hlbWEuY2xhc3NOYW1lfWApO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG4gIHJldHVybiBsaXN0O1xufTtcblxuaW50ZXJmYWNlIFdoZXJlQ2xhdXNlIHtcbiAgcGF0dGVybjogc3RyaW5nO1xuICB2YWx1ZXM6IEFycmF5PGFueT47XG4gIHNvcnRzOiBBcnJheTxhbnk+O1xufVxuXG5jb25zdCBidWlsZFdoZXJlQ2xhdXNlID0gKHsgc2NoZW1hLCBxdWVyeSwgaW5kZXggfSk6IFdoZXJlQ2xhdXNlID0+IHtcbiAgY29uc3QgcGF0dGVybnMgPSBbXTtcbiAgbGV0IHZhbHVlcyA9IFtdO1xuICBjb25zdCBzb3J0cyA9IFtdO1xuXG4gIHNjaGVtYSA9IHRvUG9zdGdyZXNTY2hlbWEoc2NoZW1hKTtcbiAgZm9yIChjb25zdCBmaWVsZE5hbWUgaW4gcXVlcnkpIHtcbiAgICBjb25zdCBpc0FycmF5RmllbGQgPVxuICAgICAgc2NoZW1hLmZpZWxkcyAmJlxuICAgICAgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdICYmXG4gICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ0FycmF5JztcbiAgICBjb25zdCBpbml0aWFsUGF0dGVybnNMZW5ndGggPSBwYXR0ZXJucy5sZW5ndGg7XG4gICAgY29uc3QgZmllbGRWYWx1ZSA9IHF1ZXJ5W2ZpZWxkTmFtZV07XG5cbiAgICAvLyBub3RoaW5naW4gdGhlIHNjaGVtYSwgaXQncyBnb25uYSBibG93IHVwXG4gICAgaWYgKCFzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0pIHtcbiAgICAgIC8vIGFzIGl0IHdvbid0IGV4aXN0XG4gICAgICBpZiAoZmllbGRWYWx1ZSAmJiBmaWVsZFZhbHVlLiRleGlzdHMgPT09IGZhbHNlKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChmaWVsZE5hbWUuaW5kZXhPZignLicpID49IDApIHtcbiAgICAgIGxldCBuYW1lID0gdHJhbnNmb3JtRG90RmllbGQoZmllbGROYW1lKTtcbiAgICAgIGlmIChmaWVsZFZhbHVlID09PSBudWxsKSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYCR7bmFtZX0gSVMgTlVMTGApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKGZpZWxkVmFsdWUuJGluKSB7XG4gICAgICAgICAgY29uc3QgaW5QYXR0ZXJucyA9IFtdO1xuICAgICAgICAgIG5hbWUgPSB0cmFuc2Zvcm1Eb3RGaWVsZFRvQ29tcG9uZW50cyhmaWVsZE5hbWUpLmpvaW4oJy0+Jyk7XG4gICAgICAgICAgZmllbGRWYWx1ZS4kaW4uZm9yRWFjaChsaXN0RWxlbSA9PiB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIGxpc3RFbGVtID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICBpZiAobGlzdEVsZW0uaW5jbHVkZXMoJ1wiJykgfHwgbGlzdEVsZW0uaW5jbHVkZXMoXCInXCIpKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgICAgICAgJ2JhZCAkaW4gdmFsdWU7IFN0cmluZ3Mgd2l0aCBxdW90ZXMgY2Fubm90IHlldCBiZSBzYWZlbHkgZXNjYXBlZCdcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGluUGF0dGVybnMucHVzaChgXCIke2xpc3RFbGVtfVwiYCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBpblBhdHRlcm5zLnB1c2goYCR7bGlzdEVsZW19YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcGF0dGVybnMucHVzaChgKCR7bmFtZX0pOjpqc29uYiBAPiAnWyR7aW5QYXR0ZXJucy5qb2luKCl9XSc6Ompzb25iYCk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGRWYWx1ZS4kcmVnZXgpIHtcbiAgICAgICAgICAvLyBIYW5kbGUgbGF0ZXJcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAke25hbWV9ID0gJyR7ZmllbGRWYWx1ZX0nYCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUgPT09IG51bGwgfHwgZmllbGRWYWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSBJUyBOVUxMYCk7XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUpO1xuICAgICAgaW5kZXggKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGZpZWxkVmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX1gKTtcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZSk7XG4gICAgICBpbmRleCArPSAyO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGZpZWxkVmFsdWUgPT09ICdib29sZWFuJykge1xuICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICAvLyBDYW4ndCBjYXN0IGJvb2xlYW4gdG8gZG91YmxlIHByZWNpc2lvblxuICAgICAgaWYgKFxuICAgICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0gJiZcbiAgICAgICAgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdOdW1iZXInXG4gICAgICApIHtcbiAgICAgICAgLy8gU2hvdWxkIGFsd2F5cyByZXR1cm4gemVybyByZXN1bHRzXG4gICAgICAgIGNvbnN0IE1BWF9JTlRfUExVU19PTkUgPSA5MjIzMzcyMDM2ODU0Nzc1ODA4O1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIE1BWF9JTlRfUExVU19PTkUpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlKTtcbiAgICAgIH1cbiAgICAgIGluZGV4ICs9IDI7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZmllbGRWYWx1ZSA9PT0gJ251bWJlcicpIHtcbiAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlKTtcbiAgICAgIGluZGV4ICs9IDI7XG4gICAgfSBlbHNlIGlmIChbJyRvcicsICckbm9yJywgJyRhbmQnXS5pbmNsdWRlcyhmaWVsZE5hbWUpKSB7XG4gICAgICBjb25zdCBjbGF1c2VzID0gW107XG4gICAgICBjb25zdCBjbGF1c2VWYWx1ZXMgPSBbXTtcbiAgICAgIGZpZWxkVmFsdWUuZm9yRWFjaChzdWJRdWVyeSA9PiB7XG4gICAgICAgIGNvbnN0IGNsYXVzZSA9IGJ1aWxkV2hlcmVDbGF1c2UoeyBzY2hlbWEsIHF1ZXJ5OiBzdWJRdWVyeSwgaW5kZXggfSk7XG4gICAgICAgIGlmIChjbGF1c2UucGF0dGVybi5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgY2xhdXNlcy5wdXNoKGNsYXVzZS5wYXR0ZXJuKTtcbiAgICAgICAgICBjbGF1c2VWYWx1ZXMucHVzaCguLi5jbGF1c2UudmFsdWVzKTtcbiAgICAgICAgICBpbmRleCArPSBjbGF1c2UudmFsdWVzLmxlbmd0aDtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IG9yT3JBbmQgPSBmaWVsZE5hbWUgPT09ICckYW5kJyA/ICcgQU5EICcgOiAnIE9SICc7XG4gICAgICBjb25zdCBub3QgPSBmaWVsZE5hbWUgPT09ICckbm9yJyA/ICcgTk9UICcgOiAnJztcblxuICAgICAgcGF0dGVybnMucHVzaChgJHtub3R9KCR7Y2xhdXNlcy5qb2luKG9yT3JBbmQpfSlgKTtcbiAgICAgIHZhbHVlcy5wdXNoKC4uLmNsYXVzZVZhbHVlcyk7XG4gICAgfVxuXG4gICAgaWYgKGZpZWxkVmFsdWUuJG5lICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChpc0FycmF5RmllbGQpIHtcbiAgICAgICAgZmllbGRWYWx1ZS4kbmUgPSBKU09OLnN0cmluZ2lmeShbZmllbGRWYWx1ZS4kbmVdKTtcbiAgICAgICAgcGF0dGVybnMucHVzaChgTk9UIGFycmF5X2NvbnRhaW5zKCQke2luZGV4fTpuYW1lLCAkJHtpbmRleCArIDF9KWApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKGZpZWxkVmFsdWUuJG5lID09PSBudWxsKSB7XG4gICAgICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgSVMgTk9UIE5VTExgKTtcbiAgICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUpO1xuICAgICAgICAgIGluZGV4ICs9IDE7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gaWYgbm90IG51bGwsIHdlIG5lZWQgdG8gbWFudWFsbHkgZXhjbHVkZSBudWxsXG4gICAgICAgICAgcGF0dGVybnMucHVzaChcbiAgICAgICAgICAgIGAoJCR7aW5kZXh9Om5hbWUgPD4gJCR7aW5kZXggKyAxfSBPUiAkJHtpbmRleH06bmFtZSBJUyBOVUxMKWBcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIFRPRE86IHN1cHBvcnQgYXJyYXlzXG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUuJG5lKTtcbiAgICAgIGluZGV4ICs9IDI7XG4gICAgfVxuICAgIGlmIChmaWVsZFZhbHVlLiRlcSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoZmllbGRWYWx1ZS4kZXEgPT09IG51bGwpIHtcbiAgICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgSVMgTlVMTGApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUpO1xuICAgICAgICBpbmRleCArPSAxO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZS4kZXEpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBpc0luT3JOaW4gPVxuICAgICAgQXJyYXkuaXNBcnJheShmaWVsZFZhbHVlLiRpbikgfHwgQXJyYXkuaXNBcnJheShmaWVsZFZhbHVlLiRuaW4pO1xuICAgIGlmIChcbiAgICAgIEFycmF5LmlzQXJyYXkoZmllbGRWYWx1ZS4kaW4pICYmXG4gICAgICBpc0FycmF5RmllbGQgJiZcbiAgICAgIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS5jb250ZW50cyAmJlxuICAgICAgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLmNvbnRlbnRzLnR5cGUgPT09ICdTdHJpbmcnXG4gICAgKSB7XG4gICAgICBjb25zdCBpblBhdHRlcm5zID0gW107XG4gICAgICBsZXQgYWxsb3dOdWxsID0gZmFsc2U7XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUpO1xuICAgICAgZmllbGRWYWx1ZS4kaW4uZm9yRWFjaCgobGlzdEVsZW0sIGxpc3RJbmRleCkgPT4ge1xuICAgICAgICBpZiAobGlzdEVsZW0gPT09IG51bGwpIHtcbiAgICAgICAgICBhbGxvd051bGwgPSB0cnVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHZhbHVlcy5wdXNoKGxpc3RFbGVtKTtcbiAgICAgICAgICBpblBhdHRlcm5zLnB1c2goYCQke2luZGV4ICsgMSArIGxpc3RJbmRleCAtIChhbGxvd051bGwgPyAxIDogMCl9YCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgaWYgKGFsbG93TnVsbCkge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKFxuICAgICAgICAgIGAoJCR7aW5kZXh9Om5hbWUgSVMgTlVMTCBPUiAkJHtpbmRleH06bmFtZSAmJiBBUlJBWVske2luUGF0dGVybnMuam9pbigpfV0pYFxuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgJiYgQVJSQVlbJHtpblBhdHRlcm5zLmpvaW4oKX1dYCk7XG4gICAgICB9XG4gICAgICBpbmRleCA9IGluZGV4ICsgMSArIGluUGF0dGVybnMubGVuZ3RoO1xuICAgIH0gZWxzZSBpZiAoaXNJbk9yTmluKSB7XG4gICAgICB2YXIgY3JlYXRlQ29uc3RyYWludCA9IChiYXNlQXJyYXksIG5vdEluKSA9PiB7XG4gICAgICAgIGNvbnN0IG5vdCA9IG5vdEluID8gJyBOT1QgJyA6ICcnO1xuICAgICAgICBpZiAoYmFzZUFycmF5Lmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBpZiAoaXNBcnJheUZpZWxkKSB7XG4gICAgICAgICAgICBwYXR0ZXJucy5wdXNoKFxuICAgICAgICAgICAgICBgJHtub3R9IGFycmF5X2NvbnRhaW5zKCQke2luZGV4fTpuYW1lLCAkJHtpbmRleCArIDF9KWBcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIEpTT04uc3RyaW5naWZ5KGJhc2VBcnJheSkpO1xuICAgICAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gSGFuZGxlIE5lc3RlZCBEb3QgTm90YXRpb24gQWJvdmVcbiAgICAgICAgICAgIGlmIChmaWVsZE5hbWUuaW5kZXhPZignLicpID49IDApIHtcbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgaW5QYXR0ZXJucyA9IFtdO1xuICAgICAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgICAgIGJhc2VBcnJheS5mb3JFYWNoKChsaXN0RWxlbSwgbGlzdEluZGV4KSA9PiB7XG4gICAgICAgICAgICAgIGlmIChsaXN0RWxlbSAhPT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIHZhbHVlcy5wdXNoKGxpc3RFbGVtKTtcbiAgICAgICAgICAgICAgICBpblBhdHRlcm5zLnB1c2goYCQke2luZGV4ICsgMSArIGxpc3RJbmRleH1gKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSAke25vdH0gSU4gKCR7aW5QYXR0ZXJucy5qb2luKCl9KWApO1xuICAgICAgICAgICAgaW5kZXggPSBpbmRleCArIDEgKyBpblBhdHRlcm5zLmxlbmd0aDtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoIW5vdEluKSB7XG4gICAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSBJUyBOVUxMYCk7XG4gICAgICAgICAgaW5kZXggPSBpbmRleCArIDE7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gSGFuZGxlIGVtcHR5IGFycmF5XG4gICAgICAgICAgaWYgKG5vdEluKSB7XG4gICAgICAgICAgICBwYXR0ZXJucy5wdXNoKCcxID0gMScpOyAvLyBSZXR1cm4gYWxsIHZhbHVlc1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBwYXR0ZXJucy5wdXNoKCcxID0gMicpOyAvLyBSZXR1cm4gbm8gdmFsdWVzXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuICAgICAgaWYgKGZpZWxkVmFsdWUuJGluKSB7XG4gICAgICAgIGNyZWF0ZUNvbnN0cmFpbnQoXy5mbGF0TWFwKGZpZWxkVmFsdWUuJGluLCBlbHQgPT4gZWx0KSwgZmFsc2UpO1xuICAgICAgfVxuICAgICAgaWYgKGZpZWxkVmFsdWUuJG5pbikge1xuICAgICAgICBjcmVhdGVDb25zdHJhaW50KF8uZmxhdE1hcChmaWVsZFZhbHVlLiRuaW4sIGVsdCA9PiBlbHQpLCB0cnVlKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBmaWVsZFZhbHVlLiRpbiAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdiYWQgJGluIHZhbHVlJyk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZmllbGRWYWx1ZS4kbmluICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ2JhZCAkbmluIHZhbHVlJyk7XG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZmllbGRWYWx1ZS4kYWxsKSAmJiBpc0FycmF5RmllbGQpIHtcbiAgICAgIGlmIChpc0FueVZhbHVlUmVnZXhTdGFydHNXaXRoKGZpZWxkVmFsdWUuJGFsbCkpIHtcbiAgICAgICAgaWYgKCFpc0FsbFZhbHVlc1JlZ2V4T3JOb25lKGZpZWxkVmFsdWUuJGFsbCkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICAnQWxsICRhbGwgdmFsdWVzIG11c3QgYmUgb2YgcmVnZXggdHlwZSBvciBub25lOiAnICsgZmllbGRWYWx1ZS4kYWxsXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZmllbGRWYWx1ZS4kYWxsLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgICAgY29uc3QgdmFsdWUgPSBwcm9jZXNzUmVnZXhQYXR0ZXJuKGZpZWxkVmFsdWUuJGFsbFtpXS4kcmVnZXgpO1xuICAgICAgICAgIGZpZWxkVmFsdWUuJGFsbFtpXSA9IHZhbHVlLnN1YnN0cmluZygxKSArICclJztcbiAgICAgICAgfVxuICAgICAgICBwYXR0ZXJucy5wdXNoKFxuICAgICAgICAgIGBhcnJheV9jb250YWluc19hbGxfcmVnZXgoJCR7aW5kZXh9Om5hbWUsICQke2luZGV4ICsgMX06Ompzb25iKWBcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goXG4gICAgICAgICAgYGFycmF5X2NvbnRhaW5zX2FsbCgkJHtpbmRleH06bmFtZSwgJCR7aW5kZXggKyAxfTo6anNvbmIpYFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBKU09OLnN0cmluZ2lmeShmaWVsZFZhbHVlLiRhbGwpKTtcbiAgICAgIGluZGV4ICs9IDI7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBmaWVsZFZhbHVlLiRleGlzdHMgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBpZiAoZmllbGRWYWx1ZS4kZXhpc3RzKSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lIElTIE5PVCBOVUxMYCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSBJUyBOVUxMYCk7XG4gICAgICB9XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUpO1xuICAgICAgaW5kZXggKz0gMTtcbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS4kY29udGFpbmVkQnkpIHtcbiAgICAgIGNvbnN0IGFyciA9IGZpZWxkVmFsdWUuJGNvbnRhaW5lZEJ5O1xuICAgICAgaWYgKCEoYXJyIGluc3RhbmNlb2YgQXJyYXkpKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgYGJhZCAkY29udGFpbmVkQnk6IHNob3VsZCBiZSBhbiBhcnJheWBcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPEAgJCR7aW5kZXggKyAxfTo6anNvbmJgKTtcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgSlNPTi5zdHJpbmdpZnkoYXJyKSk7XG4gICAgICBpbmRleCArPSAyO1xuICAgIH1cblxuICAgIGlmIChmaWVsZFZhbHVlLiR0ZXh0KSB7XG4gICAgICBjb25zdCBzZWFyY2ggPSBmaWVsZFZhbHVlLiR0ZXh0LiRzZWFyY2g7XG4gICAgICBsZXQgbGFuZ3VhZ2UgPSAnZW5nbGlzaCc7XG4gICAgICBpZiAodHlwZW9mIHNlYXJjaCAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICBgYmFkICR0ZXh0OiAkc2VhcmNoLCBzaG91bGQgYmUgb2JqZWN0YFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgaWYgKCFzZWFyY2guJHRlcm0gfHwgdHlwZW9mIHNlYXJjaC4kdGVybSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICBgYmFkICR0ZXh0OiAkdGVybSwgc2hvdWxkIGJlIHN0cmluZ2BcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIGlmIChzZWFyY2guJGxhbmd1YWdlICYmIHR5cGVvZiBzZWFyY2guJGxhbmd1YWdlICE9PSAnc3RyaW5nJykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGBiYWQgJHRleHQ6ICRsYW5ndWFnZSwgc2hvdWxkIGJlIHN0cmluZ2BcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSBpZiAoc2VhcmNoLiRsYW5ndWFnZSkge1xuICAgICAgICBsYW5ndWFnZSA9IHNlYXJjaC4kbGFuZ3VhZ2U7XG4gICAgICB9XG4gICAgICBpZiAoc2VhcmNoLiRjYXNlU2Vuc2l0aXZlICYmIHR5cGVvZiBzZWFyY2guJGNhc2VTZW5zaXRpdmUgIT09ICdib29sZWFuJykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGBiYWQgJHRleHQ6ICRjYXNlU2Vuc2l0aXZlLCBzaG91bGQgYmUgYm9vbGVhbmBcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSBpZiAoc2VhcmNoLiRjYXNlU2Vuc2l0aXZlKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgYGJhZCAkdGV4dDogJGNhc2VTZW5zaXRpdmUgbm90IHN1cHBvcnRlZCwgcGxlYXNlIHVzZSAkcmVnZXggb3IgY3JlYXRlIGEgc2VwYXJhdGUgbG93ZXIgY2FzZSBjb2x1bW4uYFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgaWYgKFxuICAgICAgICBzZWFyY2guJGRpYWNyaXRpY1NlbnNpdGl2ZSAmJlxuICAgICAgICB0eXBlb2Ygc2VhcmNoLiRkaWFjcml0aWNTZW5zaXRpdmUgIT09ICdib29sZWFuJ1xuICAgICAgKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgYGJhZCAkdGV4dDogJGRpYWNyaXRpY1NlbnNpdGl2ZSwgc2hvdWxkIGJlIGJvb2xlYW5gXG4gICAgICAgICk7XG4gICAgICB9IGVsc2UgaWYgKHNlYXJjaC4kZGlhY3JpdGljU2Vuc2l0aXZlID09PSBmYWxzZSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGBiYWQgJHRleHQ6ICRkaWFjcml0aWNTZW5zaXRpdmUgLSBmYWxzZSBub3Qgc3VwcG9ydGVkLCBpbnN0YWxsIFBvc3RncmVzIFVuYWNjZW50IEV4dGVuc2lvbmBcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHBhdHRlcm5zLnB1c2goXG4gICAgICAgIGB0b190c3ZlY3RvcigkJHtpbmRleH0sICQke2luZGV4ICsgMX06bmFtZSkgQEAgdG9fdHNxdWVyeSgkJHtpbmRleCArXG4gICAgICAgICAgMn0sICQke2luZGV4ICsgM30pYFxuICAgICAgKTtcbiAgICAgIHZhbHVlcy5wdXNoKGxhbmd1YWdlLCBmaWVsZE5hbWUsIGxhbmd1YWdlLCBzZWFyY2guJHRlcm0pO1xuICAgICAgaW5kZXggKz0gNDtcbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS4kbmVhclNwaGVyZSkge1xuICAgICAgY29uc3QgcG9pbnQgPSBmaWVsZFZhbHVlLiRuZWFyU3BoZXJlO1xuICAgICAgY29uc3QgZGlzdGFuY2UgPSBmaWVsZFZhbHVlLiRtYXhEaXN0YW5jZTtcbiAgICAgIGNvbnN0IGRpc3RhbmNlSW5LTSA9IGRpc3RhbmNlICogNjM3MSAqIDEwMDA7XG4gICAgICBwYXR0ZXJucy5wdXNoKFxuICAgICAgICBgU1RfZGlzdGFuY2Vfc3BoZXJlKCQke2luZGV4fTpuYW1lOjpnZW9tZXRyeSwgUE9JTlQoJCR7aW5kZXggK1xuICAgICAgICAgIDF9LCAkJHtpbmRleCArIDJ9KTo6Z2VvbWV0cnkpIDw9ICQke2luZGV4ICsgM31gXG4gICAgICApO1xuICAgICAgc29ydHMucHVzaChcbiAgICAgICAgYFNUX2Rpc3RhbmNlX3NwaGVyZSgkJHtpbmRleH06bmFtZTo6Z2VvbWV0cnksIFBPSU5UKCQke2luZGV4ICtcbiAgICAgICAgICAxfSwgJCR7aW5kZXggKyAyfSk6Omdlb21ldHJ5KSBBU0NgXG4gICAgICApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBwb2ludC5sb25naXR1ZGUsIHBvaW50LmxhdGl0dWRlLCBkaXN0YW5jZUluS00pO1xuICAgICAgaW5kZXggKz0gNDtcbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS4kd2l0aGluICYmIGZpZWxkVmFsdWUuJHdpdGhpbi4kYm94KSB7XG4gICAgICBjb25zdCBib3ggPSBmaWVsZFZhbHVlLiR3aXRoaW4uJGJveDtcbiAgICAgIGNvbnN0IGxlZnQgPSBib3hbMF0ubG9uZ2l0dWRlO1xuICAgICAgY29uc3QgYm90dG9tID0gYm94WzBdLmxhdGl0dWRlO1xuICAgICAgY29uc3QgcmlnaHQgPSBib3hbMV0ubG9uZ2l0dWRlO1xuICAgICAgY29uc3QgdG9wID0gYm94WzFdLmxhdGl0dWRlO1xuXG4gICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZTo6cG9pbnQgPEAgJCR7aW5kZXggKyAxfTo6Ym94YCk7XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGAoKCR7bGVmdH0sICR7Ym90dG9tfSksICgke3JpZ2h0fSwgJHt0b3B9KSlgKTtcbiAgICAgIGluZGV4ICs9IDI7XG4gICAgfVxuXG4gICAgaWYgKGZpZWxkVmFsdWUuJGdlb1dpdGhpbiAmJiBmaWVsZFZhbHVlLiRnZW9XaXRoaW4uJGNlbnRlclNwaGVyZSkge1xuICAgICAgY29uc3QgY2VudGVyU3BoZXJlID0gZmllbGRWYWx1ZS4kZ2VvV2l0aGluLiRjZW50ZXJTcGhlcmU7XG4gICAgICBpZiAoIShjZW50ZXJTcGhlcmUgaW5zdGFuY2VvZiBBcnJheSkgfHwgY2VudGVyU3BoZXJlLmxlbmd0aCA8IDIpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAnYmFkICRnZW9XaXRoaW4gdmFsdWU7ICRjZW50ZXJTcGhlcmUgc2hvdWxkIGJlIGFuIGFycmF5IG9mIFBhcnNlLkdlb1BvaW50IGFuZCBkaXN0YW5jZSdcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIC8vIEdldCBwb2ludCwgY29udmVydCB0byBnZW8gcG9pbnQgaWYgbmVjZXNzYXJ5IGFuZCB2YWxpZGF0ZVxuICAgICAgbGV0IHBvaW50ID0gY2VudGVyU3BoZXJlWzBdO1xuICAgICAgaWYgKHBvaW50IGluc3RhbmNlb2YgQXJyYXkgJiYgcG9pbnQubGVuZ3RoID09PSAyKSB7XG4gICAgICAgIHBvaW50ID0gbmV3IFBhcnNlLkdlb1BvaW50KHBvaW50WzFdLCBwb2ludFswXSk7XG4gICAgICB9IGVsc2UgaWYgKCFHZW9Qb2ludENvZGVyLmlzVmFsaWRKU09OKHBvaW50KSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICdiYWQgJGdlb1dpdGhpbiB2YWx1ZTsgJGNlbnRlclNwaGVyZSBnZW8gcG9pbnQgaW52YWxpZCdcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIFBhcnNlLkdlb1BvaW50Ll92YWxpZGF0ZShwb2ludC5sYXRpdHVkZSwgcG9pbnQubG9uZ2l0dWRlKTtcbiAgICAgIC8vIEdldCBkaXN0YW5jZSBhbmQgdmFsaWRhdGVcbiAgICAgIGNvbnN0IGRpc3RhbmNlID0gY2VudGVyU3BoZXJlWzFdO1xuICAgICAgaWYgKGlzTmFOKGRpc3RhbmNlKSB8fCBkaXN0YW5jZSA8IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAnYmFkICRnZW9XaXRoaW4gdmFsdWU7ICRjZW50ZXJTcGhlcmUgZGlzdGFuY2UgaW52YWxpZCdcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGRpc3RhbmNlSW5LTSA9IGRpc3RhbmNlICogNjM3MSAqIDEwMDA7XG4gICAgICBwYXR0ZXJucy5wdXNoKFxuICAgICAgICBgU1RfZGlzdGFuY2Vfc3BoZXJlKCQke2luZGV4fTpuYW1lOjpnZW9tZXRyeSwgUE9JTlQoJCR7aW5kZXggK1xuICAgICAgICAgIDF9LCAkJHtpbmRleCArIDJ9KTo6Z2VvbWV0cnkpIDw9ICQke2luZGV4ICsgM31gXG4gICAgICApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBwb2ludC5sb25naXR1ZGUsIHBvaW50LmxhdGl0dWRlLCBkaXN0YW5jZUluS00pO1xuICAgICAgaW5kZXggKz0gNDtcbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS4kZ2VvV2l0aGluICYmIGZpZWxkVmFsdWUuJGdlb1dpdGhpbi4kcG9seWdvbikge1xuICAgICAgY29uc3QgcG9seWdvbiA9IGZpZWxkVmFsdWUuJGdlb1dpdGhpbi4kcG9seWdvbjtcbiAgICAgIGxldCBwb2ludHM7XG4gICAgICBpZiAodHlwZW9mIHBvbHlnb24gPT09ICdvYmplY3QnICYmIHBvbHlnb24uX190eXBlID09PSAnUG9seWdvbicpIHtcbiAgICAgICAgaWYgKCFwb2x5Z29uLmNvb3JkaW5hdGVzIHx8IHBvbHlnb24uY29vcmRpbmF0ZXMubGVuZ3RoIDwgMykge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICdiYWQgJGdlb1dpdGhpbiB2YWx1ZTsgUG9seWdvbi5jb29yZGluYXRlcyBzaG91bGQgY29udGFpbiBhdCBsZWFzdCAzIGxvbi9sYXQgcGFpcnMnXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBwb2ludHMgPSBwb2x5Z29uLmNvb3JkaW5hdGVzO1xuICAgICAgfSBlbHNlIGlmIChwb2x5Z29uIGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICAgICAgaWYgKHBvbHlnb24ubGVuZ3RoIDwgMykge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICdiYWQgJGdlb1dpdGhpbiB2YWx1ZTsgJHBvbHlnb24gc2hvdWxkIGNvbnRhaW4gYXQgbGVhc3QgMyBHZW9Qb2ludHMnXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBwb2ludHMgPSBwb2x5Z29uO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICBcImJhZCAkZ2VvV2l0aGluIHZhbHVlOyAkcG9seWdvbiBzaG91bGQgYmUgUG9seWdvbiBvYmplY3Qgb3IgQXJyYXkgb2YgUGFyc2UuR2VvUG9pbnQnc1wiXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBwb2ludHMgPSBwb2ludHNcbiAgICAgICAgLm1hcChwb2ludCA9PiB7XG4gICAgICAgICAgaWYgKHBvaW50IGluc3RhbmNlb2YgQXJyYXkgJiYgcG9pbnQubGVuZ3RoID09PSAyKSB7XG4gICAgICAgICAgICBQYXJzZS5HZW9Qb2ludC5fdmFsaWRhdGUocG9pbnRbMV0sIHBvaW50WzBdKTtcbiAgICAgICAgICAgIHJldHVybiBgKCR7cG9pbnRbMF19LCAke3BvaW50WzFdfSlgO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAodHlwZW9mIHBvaW50ICE9PSAnb2JqZWN0JyB8fCBwb2ludC5fX3R5cGUgIT09ICdHZW9Qb2ludCcpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgICAnYmFkICRnZW9XaXRoaW4gdmFsdWUnXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBQYXJzZS5HZW9Qb2ludC5fdmFsaWRhdGUocG9pbnQubGF0aXR1ZGUsIHBvaW50LmxvbmdpdHVkZSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBgKCR7cG9pbnQubG9uZ2l0dWRlfSwgJHtwb2ludC5sYXRpdHVkZX0pYDtcbiAgICAgICAgfSlcbiAgICAgICAgLmpvaW4oJywgJyk7XG5cbiAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lOjpwb2ludCA8QCAkJHtpbmRleCArIDF9Ojpwb2x5Z29uYCk7XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGAoJHtwb2ludHN9KWApO1xuICAgICAgaW5kZXggKz0gMjtcbiAgICB9XG4gICAgaWYgKGZpZWxkVmFsdWUuJGdlb0ludGVyc2VjdHMgJiYgZmllbGRWYWx1ZS4kZ2VvSW50ZXJzZWN0cy4kcG9pbnQpIHtcbiAgICAgIGNvbnN0IHBvaW50ID0gZmllbGRWYWx1ZS4kZ2VvSW50ZXJzZWN0cy4kcG9pbnQ7XG4gICAgICBpZiAodHlwZW9mIHBvaW50ICE9PSAnb2JqZWN0JyB8fCBwb2ludC5fX3R5cGUgIT09ICdHZW9Qb2ludCcpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAnYmFkICRnZW9JbnRlcnNlY3QgdmFsdWU7ICRwb2ludCBzaG91bGQgYmUgR2VvUG9pbnQnXG4gICAgICAgICk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBQYXJzZS5HZW9Qb2ludC5fdmFsaWRhdGUocG9pbnQubGF0aXR1ZGUsIHBvaW50LmxvbmdpdHVkZSk7XG4gICAgICB9XG4gICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZTo6cG9seWdvbiBAPiAkJHtpbmRleCArIDF9Ojpwb2ludGApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBgKCR7cG9pbnQubG9uZ2l0dWRlfSwgJHtwb2ludC5sYXRpdHVkZX0pYCk7XG4gICAgICBpbmRleCArPSAyO1xuICAgIH1cblxuICAgIGlmIChmaWVsZFZhbHVlLiRyZWdleCkge1xuICAgICAgbGV0IHJlZ2V4ID0gZmllbGRWYWx1ZS4kcmVnZXg7XG4gICAgICBsZXQgb3BlcmF0b3IgPSAnfic7XG4gICAgICBjb25zdCBvcHRzID0gZmllbGRWYWx1ZS4kb3B0aW9ucztcbiAgICAgIGlmIChvcHRzKSB7XG4gICAgICAgIGlmIChvcHRzLmluZGV4T2YoJ2knKSA+PSAwKSB7XG4gICAgICAgICAgb3BlcmF0b3IgPSAnfionO1xuICAgICAgICB9XG4gICAgICAgIGlmIChvcHRzLmluZGV4T2YoJ3gnKSA+PSAwKSB7XG4gICAgICAgICAgcmVnZXggPSByZW1vdmVXaGl0ZVNwYWNlKHJlZ2V4KTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBuYW1lID0gdHJhbnNmb3JtRG90RmllbGQoZmllbGROYW1lKTtcbiAgICAgIHJlZ2V4ID0gcHJvY2Vzc1JlZ2V4UGF0dGVybihyZWdleCk7XG5cbiAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpyYXcgJHtvcGVyYXRvcn0gJyQke2luZGV4ICsgMX06cmF3J2ApO1xuICAgICAgdmFsdWVzLnB1c2gobmFtZSwgcmVnZXgpO1xuICAgICAgaW5kZXggKz0gMjtcbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS5fX3R5cGUgPT09ICdQb2ludGVyJykge1xuICAgICAgaWYgKGlzQXJyYXlGaWVsZCkge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGBhcnJheV9jb250YWlucygkJHtpbmRleH06bmFtZSwgJCR7aW5kZXggKyAxfSlgKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBKU09OLnN0cmluZ2lmeShbZmllbGRWYWx1ZV0pKTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUub2JqZWN0SWQpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChmaWVsZFZhbHVlLl9fdHlwZSA9PT0gJ0RhdGUnKSB7XG4gICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX1gKTtcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZS5pc28pO1xuICAgICAgaW5kZXggKz0gMjtcbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS5fX3R5cGUgPT09ICdHZW9Qb2ludCcpIHtcbiAgICAgIHBhdHRlcm5zLnB1c2goXG4gICAgICAgICckJyArXG4gICAgICAgICAgaW5kZXggK1xuICAgICAgICAgICc6bmFtZSB+PSBQT0lOVCgkJyArXG4gICAgICAgICAgKGluZGV4ICsgMSkgK1xuICAgICAgICAgICcsICQnICtcbiAgICAgICAgICAoaW5kZXggKyAyKSArXG4gICAgICAgICAgJyknXG4gICAgICApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlLmxvbmdpdHVkZSwgZmllbGRWYWx1ZS5sYXRpdHVkZSk7XG4gICAgICBpbmRleCArPSAzO1xuICAgIH1cblxuICAgIGlmIChmaWVsZFZhbHVlLl9fdHlwZSA9PT0gJ1BvbHlnb24nKSB7XG4gICAgICBjb25zdCB2YWx1ZSA9IGNvbnZlcnRQb2x5Z29uVG9TUUwoZmllbGRWYWx1ZS5jb29yZGluYXRlcyk7XG4gICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSB+PSAkJHtpbmRleCArIDF9Ojpwb2x5Z29uYCk7XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIHZhbHVlKTtcbiAgICAgIGluZGV4ICs9IDI7XG4gICAgfVxuXG4gICAgT2JqZWN0LmtleXMoUGFyc2VUb1Bvc2dyZXNDb21wYXJhdG9yKS5mb3JFYWNoKGNtcCA9PiB7XG4gICAgICBpZiAoZmllbGRWYWx1ZVtjbXBdIHx8IGZpZWxkVmFsdWVbY21wXSA9PT0gMCkge1xuICAgICAgICBjb25zdCBwZ0NvbXBhcmF0b3IgPSBQYXJzZVRvUG9zZ3Jlc0NvbXBhcmF0b3JbY21wXTtcbiAgICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgJHtwZ0NvbXBhcmF0b3J9ICQke2luZGV4ICsgMX1gKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCB0b1Bvc3RncmVzVmFsdWUoZmllbGRWYWx1ZVtjbXBdKSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBpZiAoaW5pdGlhbFBhdHRlcm5zTGVuZ3RoID09PSBwYXR0ZXJucy5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgICAgYFBvc3RncmVzIGRvZXNuJ3Qgc3VwcG9ydCB0aGlzIHF1ZXJ5IHR5cGUgeWV0ICR7SlNPTi5zdHJpbmdpZnkoXG4gICAgICAgICAgZmllbGRWYWx1ZVxuICAgICAgICApfWBcbiAgICAgICk7XG4gICAgfVxuICB9XG4gIHZhbHVlcyA9IHZhbHVlcy5tYXAodHJhbnNmb3JtVmFsdWUpO1xuICByZXR1cm4geyBwYXR0ZXJuOiBwYXR0ZXJucy5qb2luKCcgQU5EICcpLCB2YWx1ZXMsIHNvcnRzIH07XG59O1xuXG5leHBvcnQgY2xhc3MgUG9zdGdyZXNTdG9yYWdlQWRhcHRlciBpbXBsZW1lbnRzIFN0b3JhZ2VBZGFwdGVyIHtcbiAgY2FuU29ydE9uSm9pblRhYmxlczogYm9vbGVhbjtcblxuICAvLyBQcml2YXRlXG4gIF9jb2xsZWN0aW9uUHJlZml4OiBzdHJpbmc7XG4gIF9jbGllbnQ6IGFueTtcbiAgX3BncDogYW55O1xuXG4gIGNvbnN0cnVjdG9yKHsgdXJpLCBjb2xsZWN0aW9uUHJlZml4ID0gJycsIGRhdGFiYXNlT3B0aW9ucyB9OiBhbnkpIHtcbiAgICB0aGlzLl9jb2xsZWN0aW9uUHJlZml4ID0gY29sbGVjdGlvblByZWZpeDtcbiAgICBjb25zdCB7IGNsaWVudCwgcGdwIH0gPSBjcmVhdGVDbGllbnQodXJpLCBkYXRhYmFzZU9wdGlvbnMpO1xuICAgIHRoaXMuX2NsaWVudCA9IGNsaWVudDtcbiAgICB0aGlzLl9wZ3AgPSBwZ3A7XG4gICAgdGhpcy5jYW5Tb3J0T25Kb2luVGFibGVzID0gZmFsc2U7XG4gIH1cblxuICBoYW5kbGVTaHV0ZG93bigpIHtcbiAgICBpZiAoIXRoaXMuX2NsaWVudCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLl9jbGllbnQuJHBvb2wuZW5kKCk7XG4gIH1cblxuICBfZW5zdXJlU2NoZW1hQ29sbGVjdGlvbkV4aXN0cyhjb25uOiBhbnkpIHtcbiAgICBjb25uID0gY29ubiB8fCB0aGlzLl9jbGllbnQ7XG4gICAgcmV0dXJuIGNvbm5cbiAgICAgIC5ub25lKFxuICAgICAgICAnQ1JFQVRFIFRBQkxFIElGIE5PVCBFWElTVFMgXCJfU0NIRU1BXCIgKCBcImNsYXNzTmFtZVwiIHZhckNoYXIoMTIwKSwgXCJzY2hlbWFcIiBqc29uYiwgXCJpc1BhcnNlQ2xhc3NcIiBib29sLCBQUklNQVJZIEtFWSAoXCJjbGFzc05hbWVcIikgKSdcbiAgICAgIClcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChcbiAgICAgICAgICBlcnJvci5jb2RlID09PSBQb3N0Z3Jlc0R1cGxpY2F0ZVJlbGF0aW9uRXJyb3IgfHxcbiAgICAgICAgICBlcnJvci5jb2RlID09PSBQb3N0Z3Jlc1VuaXF1ZUluZGV4VmlvbGF0aW9uRXJyb3IgfHxcbiAgICAgICAgICBlcnJvci5jb2RlID09PSBQb3N0Z3Jlc0R1cGxpY2F0ZU9iamVjdEVycm9yXG4gICAgICAgICkge1xuICAgICAgICAgIC8vIFRhYmxlIGFscmVhZHkgZXhpc3RzLCBtdXN0IGhhdmUgYmVlbiBjcmVhdGVkIGJ5IGEgZGlmZmVyZW50IHJlcXVlc3QuIElnbm9yZSBlcnJvci5cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gIH1cblxuICBjbGFzc0V4aXN0cyhuYW1lOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50Lm9uZShcbiAgICAgICdTRUxFQ1QgRVhJU1RTIChTRUxFQ1QgMSBGUk9NIGluZm9ybWF0aW9uX3NjaGVtYS50YWJsZXMgV0hFUkUgdGFibGVfbmFtZSA9ICQxKScsXG4gICAgICBbbmFtZV0sXG4gICAgICBhID0+IGEuZXhpc3RzXG4gICAgKTtcbiAgfVxuXG4gIHNldENsYXNzTGV2ZWxQZXJtaXNzaW9ucyhjbGFzc05hbWU6IHN0cmluZywgQ0xQczogYW55KSB7XG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudC50YXNrKCdzZXQtY2xhc3MtbGV2ZWwtcGVybWlzc2lvbnMnLCBmdW5jdGlvbioodCkge1xuICAgICAgeWllbGQgc2VsZi5fZW5zdXJlU2NoZW1hQ29sbGVjdGlvbkV4aXN0cyh0KTtcbiAgICAgIGNvbnN0IHZhbHVlcyA9IFtcbiAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAnc2NoZW1hJyxcbiAgICAgICAgJ2NsYXNzTGV2ZWxQZXJtaXNzaW9ucycsXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KENMUHMpLFxuICAgICAgXTtcbiAgICAgIHlpZWxkIHQubm9uZShcbiAgICAgICAgYFVQREFURSBcIl9TQ0hFTUFcIiBTRVQgJDI6bmFtZSA9IGpzb25fb2JqZWN0X3NldF9rZXkoJDI6bmFtZSwgJDM6OnRleHQsICQ0Ojpqc29uYikgV0hFUkUgXCJjbGFzc05hbWVcIj0kMWAsXG4gICAgICAgIHZhbHVlc1xuICAgICAgKTtcbiAgICB9KTtcbiAgfVxuXG4gIHNldEluZGV4ZXNXaXRoU2NoZW1hRm9ybWF0KFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIHN1Ym1pdHRlZEluZGV4ZXM6IGFueSxcbiAgICBleGlzdGluZ0luZGV4ZXM6IGFueSA9IHt9LFxuICAgIGZpZWxkczogYW55LFxuICAgIGNvbm46ID9hbnlcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29ubiA9IGNvbm4gfHwgdGhpcy5fY2xpZW50O1xuICAgIGNvbnN0IHNlbGYgPSB0aGlzO1xuICAgIGlmIChzdWJtaXR0ZWRJbmRleGVzID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG4gICAgaWYgKE9iamVjdC5rZXlzKGV4aXN0aW5nSW5kZXhlcykubGVuZ3RoID09PSAwKSB7XG4gICAgICBleGlzdGluZ0luZGV4ZXMgPSB7IF9pZF86IHsgX2lkOiAxIH0gfTtcbiAgICB9XG4gICAgY29uc3QgZGVsZXRlZEluZGV4ZXMgPSBbXTtcbiAgICBjb25zdCBpbnNlcnRlZEluZGV4ZXMgPSBbXTtcbiAgICBPYmplY3Qua2V5cyhzdWJtaXR0ZWRJbmRleGVzKS5mb3JFYWNoKG5hbWUgPT4ge1xuICAgICAgY29uc3QgZmllbGQgPSBzdWJtaXR0ZWRJbmRleGVzW25hbWVdO1xuICAgICAgaWYgKGV4aXN0aW5nSW5kZXhlc1tuYW1lXSAmJiBmaWVsZC5fX29wICE9PSAnRGVsZXRlJykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSxcbiAgICAgICAgICBgSW5kZXggJHtuYW1lfSBleGlzdHMsIGNhbm5vdCB1cGRhdGUuYFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgaWYgKCFleGlzdGluZ0luZGV4ZXNbbmFtZV0gJiYgZmllbGQuX19vcCA9PT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksXG4gICAgICAgICAgYEluZGV4ICR7bmFtZX0gZG9lcyBub3QgZXhpc3QsIGNhbm5vdCBkZWxldGUuYFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgaWYgKGZpZWxkLl9fb3AgPT09ICdEZWxldGUnKSB7XG4gICAgICAgIGRlbGV0ZWRJbmRleGVzLnB1c2gobmFtZSk7XG4gICAgICAgIGRlbGV0ZSBleGlzdGluZ0luZGV4ZXNbbmFtZV07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBPYmplY3Qua2V5cyhmaWVsZCkuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgICAgIGlmICghZmllbGRzLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSxcbiAgICAgICAgICAgICAgYEZpZWxkICR7a2V5fSBkb2VzIG5vdCBleGlzdCwgY2Fubm90IGFkZCBpbmRleC5gXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGV4aXN0aW5nSW5kZXhlc1tuYW1lXSA9IGZpZWxkO1xuICAgICAgICBpbnNlcnRlZEluZGV4ZXMucHVzaCh7XG4gICAgICAgICAga2V5OiBmaWVsZCxcbiAgICAgICAgICBuYW1lLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gY29ubi50eCgnc2V0LWluZGV4ZXMtd2l0aC1zY2hlbWEtZm9ybWF0JywgZnVuY3Rpb24qKHQpIHtcbiAgICAgIGlmIChpbnNlcnRlZEluZGV4ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICB5aWVsZCBzZWxmLmNyZWF0ZUluZGV4ZXMoY2xhc3NOYW1lLCBpbnNlcnRlZEluZGV4ZXMsIHQpO1xuICAgICAgfVxuICAgICAgaWYgKGRlbGV0ZWRJbmRleGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgeWllbGQgc2VsZi5kcm9wSW5kZXhlcyhjbGFzc05hbWUsIGRlbGV0ZWRJbmRleGVzLCB0KTtcbiAgICAgIH1cbiAgICAgIHlpZWxkIHNlbGYuX2Vuc3VyZVNjaGVtYUNvbGxlY3Rpb25FeGlzdHModCk7XG4gICAgICB5aWVsZCB0Lm5vbmUoXG4gICAgICAgICdVUERBVEUgXCJfU0NIRU1BXCIgU0VUICQyOm5hbWUgPSBqc29uX29iamVjdF9zZXRfa2V5KCQyOm5hbWUsICQzOjp0ZXh0LCAkNDo6anNvbmIpIFdIRVJFIFwiY2xhc3NOYW1lXCI9JDEnLFxuICAgICAgICBbY2xhc3NOYW1lLCAnc2NoZW1hJywgJ2luZGV4ZXMnLCBKU09OLnN0cmluZ2lmeShleGlzdGluZ0luZGV4ZXMpXVxuICAgICAgKTtcbiAgICB9KTtcbiAgfVxuXG4gIGNyZWF0ZUNsYXNzKGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIGNvbm46ID9hbnkpIHtcbiAgICBjb25uID0gY29ubiB8fCB0aGlzLl9jbGllbnQ7XG4gICAgcmV0dXJuIGNvbm5cbiAgICAgIC50eCgnY3JlYXRlLWNsYXNzJywgdCA9PiB7XG4gICAgICAgIGNvbnN0IHExID0gdGhpcy5jcmVhdGVUYWJsZShjbGFzc05hbWUsIHNjaGVtYSwgdCk7XG4gICAgICAgIGNvbnN0IHEyID0gdC5ub25lKFxuICAgICAgICAgICdJTlNFUlQgSU5UTyBcIl9TQ0hFTUFcIiAoXCJjbGFzc05hbWVcIiwgXCJzY2hlbWFcIiwgXCJpc1BhcnNlQ2xhc3NcIikgVkFMVUVTICgkPGNsYXNzTmFtZT4sICQ8c2NoZW1hPiwgdHJ1ZSknLFxuICAgICAgICAgIHsgY2xhc3NOYW1lLCBzY2hlbWEgfVxuICAgICAgICApO1xuICAgICAgICBjb25zdCBxMyA9IHRoaXMuc2V0SW5kZXhlc1dpdGhTY2hlbWFGb3JtYXQoXG4gICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgIHNjaGVtYS5pbmRleGVzLFxuICAgICAgICAgIHt9LFxuICAgICAgICAgIHNjaGVtYS5maWVsZHMsXG4gICAgICAgICAgdFxuICAgICAgICApO1xuICAgICAgICByZXR1cm4gdC5iYXRjaChbcTEsIHEyLCBxM10pO1xuICAgICAgfSlcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIHRvUGFyc2VTY2hlbWEoc2NoZW1hKTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyID0+IHtcbiAgICAgICAgaWYgKGVyci5kYXRhWzBdLnJlc3VsdC5jb2RlID09PSBQb3N0Z3Jlc1RyYW5zYWN0aW9uQWJvcnRlZEVycm9yKSB7XG4gICAgICAgICAgZXJyID0gZXJyLmRhdGFbMV0ucmVzdWx0O1xuICAgICAgICB9XG4gICAgICAgIGlmIChcbiAgICAgICAgICBlcnIuY29kZSA9PT0gUG9zdGdyZXNVbmlxdWVJbmRleFZpb2xhdGlvbkVycm9yICYmXG4gICAgICAgICAgZXJyLmRldGFpbC5pbmNsdWRlcyhjbGFzc05hbWUpXG4gICAgICAgICkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLkRVUExJQ0FURV9WQUxVRSxcbiAgICAgICAgICAgIGBDbGFzcyAke2NsYXNzTmFtZX0gYWxyZWFkeSBleGlzdHMuYFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfSk7XG4gIH1cblxuICAvLyBKdXN0IGNyZWF0ZSBhIHRhYmxlLCBkbyBub3QgaW5zZXJ0IGluIHNjaGVtYVxuICBjcmVhdGVUYWJsZShjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBjb25uOiBhbnkpIHtcbiAgICBjb25uID0gY29ubiB8fCB0aGlzLl9jbGllbnQ7XG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgZGVidWcoJ2NyZWF0ZVRhYmxlJywgY2xhc3NOYW1lLCBzY2hlbWEpO1xuICAgIGNvbnN0IHZhbHVlc0FycmF5ID0gW107XG4gICAgY29uc3QgcGF0dGVybnNBcnJheSA9IFtdO1xuICAgIGNvbnN0IGZpZWxkcyA9IE9iamVjdC5hc3NpZ24oe30sIHNjaGVtYS5maWVsZHMpO1xuICAgIGlmIChjbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICAgIGZpZWxkcy5fZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQgPSB7IHR5cGU6ICdEYXRlJyB9O1xuICAgICAgZmllbGRzLl9lbWFpbF92ZXJpZnlfdG9rZW4gPSB7IHR5cGU6ICdTdHJpbmcnIH07XG4gICAgICBmaWVsZHMuX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0ID0geyB0eXBlOiAnRGF0ZScgfTtcbiAgICAgIGZpZWxkcy5fZmFpbGVkX2xvZ2luX2NvdW50ID0geyB0eXBlOiAnTnVtYmVyJyB9O1xuICAgICAgZmllbGRzLl9wZXJpc2hhYmxlX3Rva2VuID0geyB0eXBlOiAnU3RyaW5nJyB9O1xuICAgICAgZmllbGRzLl9wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQgPSB7IHR5cGU6ICdEYXRlJyB9O1xuICAgICAgZmllbGRzLl9wYXNzd29yZF9jaGFuZ2VkX2F0ID0geyB0eXBlOiAnRGF0ZScgfTtcbiAgICAgIGZpZWxkcy5fcGFzc3dvcmRfaGlzdG9yeSA9IHsgdHlwZTogJ0FycmF5JyB9O1xuICAgIH1cbiAgICBsZXQgaW5kZXggPSAyO1xuICAgIGNvbnN0IHJlbGF0aW9ucyA9IFtdO1xuICAgIE9iamVjdC5rZXlzKGZpZWxkcykuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgICAgY29uc3QgcGFyc2VUeXBlID0gZmllbGRzW2ZpZWxkTmFtZV07XG4gICAgICAvLyBTa2lwIHdoZW4gaXQncyBhIHJlbGF0aW9uXG4gICAgICAvLyBXZSdsbCBjcmVhdGUgdGhlIHRhYmxlcyBsYXRlclxuICAgICAgaWYgKHBhcnNlVHlwZS50eXBlID09PSAnUmVsYXRpb24nKSB7XG4gICAgICAgIHJlbGF0aW9ucy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGlmIChbJ19ycGVybScsICdfd3Blcm0nXS5pbmRleE9mKGZpZWxkTmFtZSkgPj0gMCkge1xuICAgICAgICBwYXJzZVR5cGUuY29udGVudHMgPSB7IHR5cGU6ICdTdHJpbmcnIH07XG4gICAgICB9XG4gICAgICB2YWx1ZXNBcnJheS5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICB2YWx1ZXNBcnJheS5wdXNoKHBhcnNlVHlwZVRvUG9zdGdyZXNUeXBlKHBhcnNlVHlwZSkpO1xuICAgICAgcGF0dGVybnNBcnJheS5wdXNoKGAkJHtpbmRleH06bmFtZSAkJHtpbmRleCArIDF9OnJhd2ApO1xuICAgICAgaWYgKGZpZWxkTmFtZSA9PT0gJ29iamVjdElkJykge1xuICAgICAgICBwYXR0ZXJuc0FycmF5LnB1c2goYFBSSU1BUlkgS0VZICgkJHtpbmRleH06bmFtZSlgKTtcbiAgICAgIH1cbiAgICAgIGluZGV4ID0gaW5kZXggKyAyO1xuICAgIH0pO1xuICAgIGNvbnN0IHFzID0gYENSRUFURSBUQUJMRSBJRiBOT1QgRVhJU1RTICQxOm5hbWUgKCR7cGF0dGVybnNBcnJheS5qb2luKCl9KWA7XG4gICAgY29uc3QgdmFsdWVzID0gW2NsYXNzTmFtZSwgLi4udmFsdWVzQXJyYXldO1xuXG4gICAgZGVidWcocXMsIHZhbHVlcyk7XG4gICAgcmV0dXJuIGNvbm4udGFzaygnY3JlYXRlLXRhYmxlJywgZnVuY3Rpb24qKHQpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHlpZWxkIHNlbGYuX2Vuc3VyZVNjaGVtYUNvbGxlY3Rpb25FeGlzdHModCk7XG4gICAgICAgIHlpZWxkIHQubm9uZShxcywgdmFsdWVzKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlICE9PSBQb3N0Z3Jlc0R1cGxpY2F0ZVJlbGF0aW9uRXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgICAvLyBFTFNFOiBUYWJsZSBhbHJlYWR5IGV4aXN0cywgbXVzdCBoYXZlIGJlZW4gY3JlYXRlZCBieSBhIGRpZmZlcmVudCByZXF1ZXN0LiBJZ25vcmUgdGhlIGVycm9yLlxuICAgICAgfVxuICAgICAgeWllbGQgdC50eCgnY3JlYXRlLXRhYmxlLXR4JywgdHggPT4ge1xuICAgICAgICByZXR1cm4gdHguYmF0Y2goXG4gICAgICAgICAgcmVsYXRpb25zLm1hcChmaWVsZE5hbWUgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHR4Lm5vbmUoXG4gICAgICAgICAgICAgICdDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyAkPGpvaW5UYWJsZTpuYW1lPiAoXCJyZWxhdGVkSWRcIiB2YXJDaGFyKDEyMCksIFwib3duaW5nSWRcIiB2YXJDaGFyKDEyMCksIFBSSU1BUlkgS0VZKFwicmVsYXRlZElkXCIsIFwib3duaW5nSWRcIikgKScsXG4gICAgICAgICAgICAgIHsgam9pblRhYmxlOiBgX0pvaW46JHtmaWVsZE5hbWV9OiR7Y2xhc3NOYW1lfWAgfVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9KVxuICAgICAgICApO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBzY2hlbWFVcGdyYWRlKGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIGNvbm46IGFueSkge1xuICAgIGRlYnVnKCdzY2hlbWFVcGdyYWRlJywgeyBjbGFzc05hbWUsIHNjaGVtYSB9KTtcbiAgICBjb25uID0gY29ubiB8fCB0aGlzLl9jbGllbnQ7XG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG5cbiAgICByZXR1cm4gY29ubi50eCgnc2NoZW1hLXVwZ3JhZGUnLCBmdW5jdGlvbioodCkge1xuICAgICAgY29uc3QgY29sdW1ucyA9IHlpZWxkIHQubWFwKFxuICAgICAgICAnU0VMRUNUIGNvbHVtbl9uYW1lIEZST00gaW5mb3JtYXRpb25fc2NoZW1hLmNvbHVtbnMgV0hFUkUgdGFibGVfbmFtZSA9ICQ8Y2xhc3NOYW1lPicsXG4gICAgICAgIHsgY2xhc3NOYW1lIH0sXG4gICAgICAgIGEgPT4gYS5jb2x1bW5fbmFtZVxuICAgICAgKTtcbiAgICAgIGNvbnN0IG5ld0NvbHVtbnMgPSBPYmplY3Qua2V5cyhzY2hlbWEuZmllbGRzKVxuICAgICAgICAuZmlsdGVyKGl0ZW0gPT4gY29sdW1ucy5pbmRleE9mKGl0ZW0pID09PSAtMSlcbiAgICAgICAgLm1hcChmaWVsZE5hbWUgPT5cbiAgICAgICAgICBzZWxmLmFkZEZpZWxkSWZOb3RFeGlzdHMoXG4gICAgICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgICAgICBmaWVsZE5hbWUsXG4gICAgICAgICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0sXG4gICAgICAgICAgICB0XG4gICAgICAgICAgKVxuICAgICAgICApO1xuXG4gICAgICB5aWVsZCB0LmJhdGNoKG5ld0NvbHVtbnMpO1xuICAgIH0pO1xuICB9XG5cbiAgYWRkRmllbGRJZk5vdEV4aXN0cyhcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBmaWVsZE5hbWU6IHN0cmluZyxcbiAgICB0eXBlOiBhbnksXG4gICAgY29ubjogYW55XG4gICkge1xuICAgIC8vIFRPRE86IE11c3QgYmUgcmV2aXNlZCBmb3IgaW52YWxpZCBsb2dpYy4uLlxuICAgIGRlYnVnKCdhZGRGaWVsZElmTm90RXhpc3RzJywgeyBjbGFzc05hbWUsIGZpZWxkTmFtZSwgdHlwZSB9KTtcbiAgICBjb25uID0gY29ubiB8fCB0aGlzLl9jbGllbnQ7XG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIGNvbm4udHgoJ2FkZC1maWVsZC1pZi1ub3QtZXhpc3RzJywgZnVuY3Rpb24qKHQpIHtcbiAgICAgIGlmICh0eXBlLnR5cGUgIT09ICdSZWxhdGlvbicpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICB5aWVsZCB0Lm5vbmUoXG4gICAgICAgICAgICAnQUxURVIgVEFCTEUgJDxjbGFzc05hbWU6bmFtZT4gQUREIENPTFVNTiAkPGZpZWxkTmFtZTpuYW1lPiAkPHBvc3RncmVzVHlwZTpyYXc+JyxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICBmaWVsZE5hbWUsXG4gICAgICAgICAgICAgIHBvc3RncmVzVHlwZTogcGFyc2VUeXBlVG9Qb3N0Z3Jlc1R5cGUodHlwZSksXG4gICAgICAgICAgICB9XG4gICAgICAgICAgKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBpZiAoZXJyb3IuY29kZSA9PT0gUG9zdGdyZXNSZWxhdGlvbkRvZXNOb3RFeGlzdEVycm9yKSB7XG4gICAgICAgICAgICByZXR1cm4geWllbGQgc2VsZi5jcmVhdGVDbGFzcyhcbiAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICB7IGZpZWxkczogeyBbZmllbGROYW1lXTogdHlwZSB9IH0sXG4gICAgICAgICAgICAgIHRcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChlcnJvci5jb2RlICE9PSBQb3N0Z3Jlc0R1cGxpY2F0ZUNvbHVtbkVycm9yKSB7XG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gQ29sdW1uIGFscmVhZHkgZXhpc3RzLCBjcmVhdGVkIGJ5IG90aGVyIHJlcXVlc3QuIENhcnJ5IG9uIHRvIHNlZSBpZiBpdCdzIHRoZSByaWdodCB0eXBlLlxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB5aWVsZCB0Lm5vbmUoXG4gICAgICAgICAgJ0NSRUFURSBUQUJMRSBJRiBOT1QgRVhJU1RTICQ8am9pblRhYmxlOm5hbWU+IChcInJlbGF0ZWRJZFwiIHZhckNoYXIoMTIwKSwgXCJvd25pbmdJZFwiIHZhckNoYXIoMTIwKSwgUFJJTUFSWSBLRVkoXCJyZWxhdGVkSWRcIiwgXCJvd25pbmdJZFwiKSApJyxcbiAgICAgICAgICB7IGpvaW5UYWJsZTogYF9Kb2luOiR7ZmllbGROYW1lfToke2NsYXNzTmFtZX1gIH1cbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVzdWx0ID0geWllbGQgdC5hbnkoXG4gICAgICAgICdTRUxFQ1QgXCJzY2hlbWFcIiBGUk9NIFwiX1NDSEVNQVwiIFdIRVJFIFwiY2xhc3NOYW1lXCIgPSAkPGNsYXNzTmFtZT4gYW5kIChcInNjaGVtYVwiOjpqc29uLT5cXCdmaWVsZHNcXCctPiQ8ZmllbGROYW1lPikgaXMgbm90IG51bGwnLFxuICAgICAgICB7IGNsYXNzTmFtZSwgZmllbGROYW1lIH1cbiAgICAgICk7XG5cbiAgICAgIGlmIChyZXN1bHRbMF0pIHtcbiAgICAgICAgdGhyb3cgJ0F0dGVtcHRlZCB0byBhZGQgYSBmaWVsZCB0aGF0IGFscmVhZHkgZXhpc3RzJztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IHBhdGggPSBge2ZpZWxkcywke2ZpZWxkTmFtZX19YDtcbiAgICAgICAgeWllbGQgdC5ub25lKFxuICAgICAgICAgICdVUERBVEUgXCJfU0NIRU1BXCIgU0VUIFwic2NoZW1hXCI9anNvbmJfc2V0KFwic2NoZW1hXCIsICQ8cGF0aD4sICQ8dHlwZT4pICBXSEVSRSBcImNsYXNzTmFtZVwiPSQ8Y2xhc3NOYW1lPicsXG4gICAgICAgICAgeyBwYXRoLCB0eXBlLCBjbGFzc05hbWUgfVxuICAgICAgICApO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLy8gRHJvcHMgYSBjb2xsZWN0aW9uLiBSZXNvbHZlcyB3aXRoIHRydWUgaWYgaXQgd2FzIGEgUGFyc2UgU2NoZW1hIChlZy4gX1VzZXIsIEN1c3RvbSwgZXRjLilcbiAgLy8gYW5kIHJlc29sdmVzIHdpdGggZmFsc2UgaWYgaXQgd2Fzbid0IChlZy4gYSBqb2luIHRhYmxlKS4gUmVqZWN0cyBpZiBkZWxldGlvbiB3YXMgaW1wb3NzaWJsZS5cbiAgZGVsZXRlQ2xhc3MoY2xhc3NOYW1lOiBzdHJpbmcpIHtcbiAgICBjb25zdCBvcGVyYXRpb25zID0gW1xuICAgICAgeyBxdWVyeTogYERST1AgVEFCTEUgSUYgRVhJU1RTICQxOm5hbWVgLCB2YWx1ZXM6IFtjbGFzc05hbWVdIH0sXG4gICAgICB7XG4gICAgICAgIHF1ZXJ5OiBgREVMRVRFIEZST00gXCJfU0NIRU1BXCIgV0hFUkUgXCJjbGFzc05hbWVcIiA9ICQxYCxcbiAgICAgICAgdmFsdWVzOiBbY2xhc3NOYW1lXSxcbiAgICAgIH0sXG4gICAgXTtcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50XG4gICAgICAudHgodCA9PiB0Lm5vbmUodGhpcy5fcGdwLmhlbHBlcnMuY29uY2F0KG9wZXJhdGlvbnMpKSlcbiAgICAgIC50aGVuKCgpID0+IGNsYXNzTmFtZS5pbmRleE9mKCdfSm9pbjonKSAhPSAwKTsgLy8gcmVzb2x2ZXMgd2l0aCBmYWxzZSB3aGVuIF9Kb2luIHRhYmxlXG4gIH1cblxuICAvLyBEZWxldGUgYWxsIGRhdGEga25vd24gdG8gdGhpcyBhZGFwdGVyLiBVc2VkIGZvciB0ZXN0aW5nLlxuICBkZWxldGVBbGxDbGFzc2VzKCkge1xuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkuZ2V0VGltZSgpO1xuICAgIGNvbnN0IGhlbHBlcnMgPSB0aGlzLl9wZ3AuaGVscGVycztcbiAgICBkZWJ1ZygnZGVsZXRlQWxsQ2xhc3NlcycpO1xuXG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudFxuICAgICAgLnRhc2soJ2RlbGV0ZS1hbGwtY2xhc3NlcycsIGZ1bmN0aW9uKih0KSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcmVzdWx0cyA9IHlpZWxkIHQuYW55KCdTRUxFQ1QgKiBGUk9NIFwiX1NDSEVNQVwiJyk7XG4gICAgICAgICAgY29uc3Qgam9pbnMgPSByZXN1bHRzLnJlZHVjZSgobGlzdDogQXJyYXk8c3RyaW5nPiwgc2NoZW1hOiBhbnkpID0+IHtcbiAgICAgICAgICAgIHJldHVybiBsaXN0LmNvbmNhdChqb2luVGFibGVzRm9yU2NoZW1hKHNjaGVtYS5zY2hlbWEpKTtcbiAgICAgICAgICB9LCBbXSk7XG4gICAgICAgICAgY29uc3QgY2xhc3NlcyA9IFtcbiAgICAgICAgICAgICdfU0NIRU1BJyxcbiAgICAgICAgICAgICdfUHVzaFN0YXR1cycsXG4gICAgICAgICAgICAnX0pvYlN0YXR1cycsXG4gICAgICAgICAgICAnX0pvYlNjaGVkdWxlJyxcbiAgICAgICAgICAgICdfSG9va3MnLFxuICAgICAgICAgICAgJ19HbG9iYWxDb25maWcnLFxuICAgICAgICAgICAgJ19BdWRpZW5jZScsXG4gICAgICAgICAgICAuLi5yZXN1bHRzLm1hcChyZXN1bHQgPT4gcmVzdWx0LmNsYXNzTmFtZSksXG4gICAgICAgICAgICAuLi5qb2lucyxcbiAgICAgICAgICBdO1xuICAgICAgICAgIGNvbnN0IHF1ZXJpZXMgPSBjbGFzc2VzLm1hcChjbGFzc05hbWUgPT4gKHtcbiAgICAgICAgICAgIHF1ZXJ5OiAnRFJPUCBUQUJMRSBJRiBFWElTVFMgJDxjbGFzc05hbWU6bmFtZT4nLFxuICAgICAgICAgICAgdmFsdWVzOiB7IGNsYXNzTmFtZSB9LFxuICAgICAgICAgIH0pKTtcbiAgICAgICAgICB5aWVsZCB0LnR4KHR4ID0+IHR4Lm5vbmUoaGVscGVycy5jb25jYXQocXVlcmllcykpKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBpZiAoZXJyb3IuY29kZSAhPT0gUG9zdGdyZXNSZWxhdGlvbkRvZXNOb3RFeGlzdEVycm9yKSB7XG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gTm8gX1NDSEVNQSBjb2xsZWN0aW9uLiBEb24ndCBkZWxldGUgYW55dGhpbmcuXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIGRlYnVnKGBkZWxldGVBbGxDbGFzc2VzIGRvbmUgaW4gJHtuZXcgRGF0ZSgpLmdldFRpbWUoKSAtIG5vd31gKTtcbiAgICAgIH0pO1xuICB9XG5cbiAgLy8gUmVtb3ZlIHRoZSBjb2x1bW4gYW5kIGFsbCB0aGUgZGF0YS4gRm9yIFJlbGF0aW9ucywgdGhlIF9Kb2luIGNvbGxlY3Rpb24gaXMgaGFuZGxlZFxuICAvLyBzcGVjaWFsbHksIHRoaXMgZnVuY3Rpb24gZG9lcyBub3QgZGVsZXRlIF9Kb2luIGNvbHVtbnMuIEl0IHNob3VsZCwgaG93ZXZlciwgaW5kaWNhdGVcbiAgLy8gdGhhdCB0aGUgcmVsYXRpb24gZmllbGRzIGRvZXMgbm90IGV4aXN0IGFueW1vcmUuIEluIG1vbmdvLCB0aGlzIG1lYW5zIHJlbW92aW5nIGl0IGZyb21cbiAgLy8gdGhlIF9TQ0hFTUEgY29sbGVjdGlvbi4gIFRoZXJlIHNob3VsZCBiZSBubyBhY3R1YWwgZGF0YSBpbiB0aGUgY29sbGVjdGlvbiB1bmRlciB0aGUgc2FtZSBuYW1lXG4gIC8vIGFzIHRoZSByZWxhdGlvbiBjb2x1bW4sIHNvIGl0J3MgZmluZSB0byBhdHRlbXB0IHRvIGRlbGV0ZSBpdC4gSWYgdGhlIGZpZWxkcyBsaXN0ZWQgdG8gYmVcbiAgLy8gZGVsZXRlZCBkbyBub3QgZXhpc3QsIHRoaXMgZnVuY3Rpb24gc2hvdWxkIHJldHVybiBzdWNjZXNzZnVsbHkgYW55d2F5cy4gQ2hlY2tpbmcgZm9yXG4gIC8vIGF0dGVtcHRzIHRvIGRlbGV0ZSBub24tZXhpc3RlbnQgZmllbGRzIGlzIHRoZSByZXNwb25zaWJpbGl0eSBvZiBQYXJzZSBTZXJ2ZXIuXG5cbiAgLy8gVGhpcyBmdW5jdGlvbiBpcyBub3Qgb2JsaWdhdGVkIHRvIGRlbGV0ZSBmaWVsZHMgYXRvbWljYWxseS4gSXQgaXMgZ2l2ZW4gdGhlIGZpZWxkXG4gIC8vIG5hbWVzIGluIGEgbGlzdCBzbyB0aGF0IGRhdGFiYXNlcyB0aGF0IGFyZSBjYXBhYmxlIG9mIGRlbGV0aW5nIGZpZWxkcyBhdG9taWNhbGx5XG4gIC8vIG1heSBkbyBzby5cblxuICAvLyBSZXR1cm5zIGEgUHJvbWlzZS5cbiAgZGVsZXRlRmllbGRzKFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIHNjaGVtYTogU2NoZW1hVHlwZSxcbiAgICBmaWVsZE5hbWVzOiBzdHJpbmdbXVxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBkZWJ1ZygnZGVsZXRlRmllbGRzJywgY2xhc3NOYW1lLCBmaWVsZE5hbWVzKTtcbiAgICBmaWVsZE5hbWVzID0gZmllbGROYW1lcy5yZWR1Y2UoKGxpc3Q6IEFycmF5PHN0cmluZz4sIGZpZWxkTmFtZTogc3RyaW5nKSA9PiB7XG4gICAgICBjb25zdCBmaWVsZCA9IHNjaGVtYS5maWVsZHNbZmllbGROYW1lXTtcbiAgICAgIGlmIChmaWVsZC50eXBlICE9PSAnUmVsYXRpb24nKSB7XG4gICAgICAgIGxpc3QucHVzaChmaWVsZE5hbWUpO1xuICAgICAgfVxuICAgICAgZGVsZXRlIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXTtcbiAgICAgIHJldHVybiBsaXN0O1xuICAgIH0sIFtdKTtcblxuICAgIGNvbnN0IHZhbHVlcyA9IFtjbGFzc05hbWUsIC4uLmZpZWxkTmFtZXNdO1xuICAgIGNvbnN0IGNvbHVtbnMgPSBmaWVsZE5hbWVzXG4gICAgICAubWFwKChuYW1lLCBpZHgpID0+IHtcbiAgICAgICAgcmV0dXJuIGAkJHtpZHggKyAyfTpuYW1lYDtcbiAgICAgIH0pXG4gICAgICAuam9pbignLCBEUk9QIENPTFVNTicpO1xuXG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudC50eCgnZGVsZXRlLWZpZWxkcycsIGZ1bmN0aW9uKih0KSB7XG4gICAgICB5aWVsZCB0Lm5vbmUoXG4gICAgICAgICdVUERBVEUgXCJfU0NIRU1BXCIgU0VUIFwic2NoZW1hXCI9JDxzY2hlbWE+IFdIRVJFIFwiY2xhc3NOYW1lXCI9JDxjbGFzc05hbWU+JyxcbiAgICAgICAgeyBzY2hlbWEsIGNsYXNzTmFtZSB9XG4gICAgICApO1xuICAgICAgaWYgKHZhbHVlcy5sZW5ndGggPiAxKSB7XG4gICAgICAgIHlpZWxkIHQubm9uZShgQUxURVIgVEFCTEUgJDE6bmFtZSBEUk9QIENPTFVNTiAke2NvbHVtbnN9YCwgdmFsdWVzKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8vIFJldHVybiBhIHByb21pc2UgZm9yIGFsbCBzY2hlbWFzIGtub3duIHRvIHRoaXMgYWRhcHRlciwgaW4gUGFyc2UgZm9ybWF0LiBJbiBjYXNlIHRoZVxuICAvLyBzY2hlbWFzIGNhbm5vdCBiZSByZXRyaWV2ZWQsIHJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVqZWN0cy4gUmVxdWlyZW1lbnRzIGZvciB0aGVcbiAgLy8gcmVqZWN0aW9uIHJlYXNvbiBhcmUgVEJELlxuICBnZXRBbGxDbGFzc2VzKCkge1xuICAgIGNvbnN0IHNlbGYgPSB0aGlzO1xuICAgIHJldHVybiB0aGlzLl9jbGllbnQudGFzaygnZ2V0LWFsbC1jbGFzc2VzJywgZnVuY3Rpb24qKHQpIHtcbiAgICAgIHlpZWxkIHNlbGYuX2Vuc3VyZVNjaGVtYUNvbGxlY3Rpb25FeGlzdHModCk7XG4gICAgICByZXR1cm4geWllbGQgdC5tYXAoJ1NFTEVDVCAqIEZST00gXCJfU0NIRU1BXCInLCBudWxsLCByb3cgPT5cbiAgICAgICAgdG9QYXJzZVNjaGVtYSh7IGNsYXNzTmFtZTogcm93LmNsYXNzTmFtZSwgLi4ucm93LnNjaGVtYSB9KVxuICAgICAgKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIFJldHVybiBhIHByb21pc2UgZm9yIHRoZSBzY2hlbWEgd2l0aCB0aGUgZ2l2ZW4gbmFtZSwgaW4gUGFyc2UgZm9ybWF0LiBJZlxuICAvLyB0aGlzIGFkYXB0ZXIgZG9lc24ndCBrbm93IGFib3V0IHRoZSBzY2hlbWEsIHJldHVybiBhIHByb21pc2UgdGhhdCByZWplY3RzIHdpdGhcbiAgLy8gdW5kZWZpbmVkIGFzIHRoZSByZWFzb24uXG4gIGdldENsYXNzKGNsYXNzTmFtZTogc3RyaW5nKSB7XG4gICAgZGVidWcoJ2dldENsYXNzJywgY2xhc3NOYW1lKTtcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50XG4gICAgICAuYW55KCdTRUxFQ1QgKiBGUk9NIFwiX1NDSEVNQVwiIFdIRVJFIFwiY2xhc3NOYW1lXCI9JDxjbGFzc05hbWU+Jywge1xuICAgICAgICBjbGFzc05hbWUsXG4gICAgICB9KVxuICAgICAgLnRoZW4ocmVzdWx0ID0+IHtcbiAgICAgICAgaWYgKHJlc3VsdC5sZW5ndGggIT09IDEpIHtcbiAgICAgICAgICB0aHJvdyB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdFswXS5zY2hlbWE7XG4gICAgICB9KVxuICAgICAgLnRoZW4odG9QYXJzZVNjaGVtYSk7XG4gIH1cblxuICAvLyBUT0RPOiByZW1vdmUgdGhlIG1vbmdvIGZvcm1hdCBkZXBlbmRlbmN5IGluIHRoZSByZXR1cm4gdmFsdWVcbiAgY3JlYXRlT2JqZWN0KGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIG9iamVjdDogYW55KSB7XG4gICAgZGVidWcoJ2NyZWF0ZU9iamVjdCcsIGNsYXNzTmFtZSwgb2JqZWN0KTtcbiAgICBsZXQgY29sdW1uc0FycmF5ID0gW107XG4gICAgY29uc3QgdmFsdWVzQXJyYXkgPSBbXTtcbiAgICBzY2hlbWEgPSB0b1Bvc3RncmVzU2NoZW1hKHNjaGVtYSk7XG4gICAgY29uc3QgZ2VvUG9pbnRzID0ge307XG5cbiAgICBvYmplY3QgPSBoYW5kbGVEb3RGaWVsZHMob2JqZWN0KTtcblxuICAgIHZhbGlkYXRlS2V5cyhvYmplY3QpO1xuXG4gICAgT2JqZWN0LmtleXMob2JqZWN0KS5mb3JFYWNoKGZpZWxkTmFtZSA9PiB7XG4gICAgICBpZiAob2JqZWN0W2ZpZWxkTmFtZV0gPT09IG51bGwpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdmFyIGF1dGhEYXRhTWF0Y2ggPSBmaWVsZE5hbWUubWF0Y2goL15fYXV0aF9kYXRhXyhbYS16QS1aMC05X10rKSQvKTtcbiAgICAgIGlmIChhdXRoRGF0YU1hdGNoKSB7XG4gICAgICAgIHZhciBwcm92aWRlciA9IGF1dGhEYXRhTWF0Y2hbMV07XG4gICAgICAgIG9iamVjdFsnYXV0aERhdGEnXSA9IG9iamVjdFsnYXV0aERhdGEnXSB8fCB7fTtcbiAgICAgICAgb2JqZWN0WydhdXRoRGF0YSddW3Byb3ZpZGVyXSA9IG9iamVjdFtmaWVsZE5hbWVdO1xuICAgICAgICBkZWxldGUgb2JqZWN0W2ZpZWxkTmFtZV07XG4gICAgICAgIGZpZWxkTmFtZSA9ICdhdXRoRGF0YSc7XG4gICAgICB9XG5cbiAgICAgIGNvbHVtbnNBcnJheS5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICBpZiAoIXNjaGVtYS5maWVsZHNbZmllbGROYW1lXSAmJiBjbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIGZpZWxkTmFtZSA9PT0gJ19lbWFpbF92ZXJpZnlfdG9rZW4nIHx8XG4gICAgICAgICAgZmllbGROYW1lID09PSAnX2ZhaWxlZF9sb2dpbl9jb3VudCcgfHxcbiAgICAgICAgICBmaWVsZE5hbWUgPT09ICdfcGVyaXNoYWJsZV90b2tlbicgfHxcbiAgICAgICAgICBmaWVsZE5hbWUgPT09ICdfcGFzc3dvcmRfaGlzdG9yeSdcbiAgICAgICAgKSB7XG4gICAgICAgICAgdmFsdWVzQXJyYXkucHVzaChvYmplY3RbZmllbGROYW1lXSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZmllbGROYW1lID09PSAnX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0Jykge1xuICAgICAgICAgIGlmIChvYmplY3RbZmllbGROYW1lXSkge1xuICAgICAgICAgICAgdmFsdWVzQXJyYXkucHVzaChvYmplY3RbZmllbGROYW1lXS5pc28pO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKG51bGwpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChcbiAgICAgICAgICBmaWVsZE5hbWUgPT09ICdfYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQnIHx8XG4gICAgICAgICAgZmllbGROYW1lID09PSAnX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCcgfHxcbiAgICAgICAgICBmaWVsZE5hbWUgPT09ICdfcGFzc3dvcmRfY2hhbmdlZF9hdCdcbiAgICAgICAgKSB7XG4gICAgICAgICAgaWYgKG9iamVjdFtmaWVsZE5hbWVdKSB7XG4gICAgICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKG9iamVjdFtmaWVsZE5hbWVdLmlzbyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhbHVlc0FycmF5LnB1c2gobnVsbCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHN3aXRjaCAoc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUpIHtcbiAgICAgICAgY2FzZSAnRGF0ZSc6XG4gICAgICAgICAgaWYgKG9iamVjdFtmaWVsZE5hbWVdKSB7XG4gICAgICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKG9iamVjdFtmaWVsZE5hbWVdLmlzbyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhbHVlc0FycmF5LnB1c2gobnVsbCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdQb2ludGVyJzpcbiAgICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKG9iamVjdFtmaWVsZE5hbWVdLm9iamVjdElkKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnQXJyYXknOlxuICAgICAgICAgIGlmIChbJ19ycGVybScsICdfd3Blcm0nXS5pbmRleE9mKGZpZWxkTmFtZSkgPj0gMCkge1xuICAgICAgICAgICAgdmFsdWVzQXJyYXkucHVzaChvYmplY3RbZmllbGROYW1lXSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhbHVlc0FycmF5LnB1c2goSlNPTi5zdHJpbmdpZnkob2JqZWN0W2ZpZWxkTmFtZV0pKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ09iamVjdCc6XG4gICAgICAgIGNhc2UgJ0J5dGVzJzpcbiAgICAgICAgY2FzZSAnU3RyaW5nJzpcbiAgICAgICAgY2FzZSAnTnVtYmVyJzpcbiAgICAgICAgY2FzZSAnQm9vbGVhbic6XG4gICAgICAgICAgdmFsdWVzQXJyYXkucHVzaChvYmplY3RbZmllbGROYW1lXSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ0ZpbGUnOlxuICAgICAgICAgIHZhbHVlc0FycmF5LnB1c2gob2JqZWN0W2ZpZWxkTmFtZV0ubmFtZSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ1BvbHlnb24nOiB7XG4gICAgICAgICAgY29uc3QgdmFsdWUgPSBjb252ZXJ0UG9seWdvblRvU1FMKG9iamVjdFtmaWVsZE5hbWVdLmNvb3JkaW5hdGVzKTtcbiAgICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKHZhbHVlKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlICdHZW9Qb2ludCc6XG4gICAgICAgICAgLy8gcG9wIHRoZSBwb2ludCBhbmQgcHJvY2VzcyBsYXRlclxuICAgICAgICAgIGdlb1BvaW50c1tmaWVsZE5hbWVdID0gb2JqZWN0W2ZpZWxkTmFtZV07XG4gICAgICAgICAgY29sdW1uc0FycmF5LnBvcCgpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRocm93IGBUeXBlICR7c2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGV9IG5vdCBzdXBwb3J0ZWQgeWV0YDtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbHVtbnNBcnJheSA9IGNvbHVtbnNBcnJheS5jb25jYXQoT2JqZWN0LmtleXMoZ2VvUG9pbnRzKSk7XG4gICAgY29uc3QgaW5pdGlhbFZhbHVlcyA9IHZhbHVlc0FycmF5Lm1hcCgodmFsLCBpbmRleCkgPT4ge1xuICAgICAgbGV0IHRlcm1pbmF0aW9uID0gJyc7XG4gICAgICBjb25zdCBmaWVsZE5hbWUgPSBjb2x1bW5zQXJyYXlbaW5kZXhdO1xuICAgICAgaWYgKFsnX3JwZXJtJywgJ193cGVybSddLmluZGV4T2YoZmllbGROYW1lKSA+PSAwKSB7XG4gICAgICAgIHRlcm1pbmF0aW9uID0gJzo6dGV4dFtdJztcbiAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXSAmJlxuICAgICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ0FycmF5J1xuICAgICAgKSB7XG4gICAgICAgIHRlcm1pbmF0aW9uID0gJzo6anNvbmInO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGAkJHtpbmRleCArIDIgKyBjb2x1bW5zQXJyYXkubGVuZ3RofSR7dGVybWluYXRpb259YDtcbiAgICB9KTtcbiAgICBjb25zdCBnZW9Qb2ludHNJbmplY3RzID0gT2JqZWN0LmtleXMoZ2VvUG9pbnRzKS5tYXAoa2V5ID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gZ2VvUG9pbnRzW2tleV07XG4gICAgICB2YWx1ZXNBcnJheS5wdXNoKHZhbHVlLmxvbmdpdHVkZSwgdmFsdWUubGF0aXR1ZGUpO1xuICAgICAgY29uc3QgbCA9IHZhbHVlc0FycmF5Lmxlbmd0aCArIGNvbHVtbnNBcnJheS5sZW5ndGg7XG4gICAgICByZXR1cm4gYFBPSU5UKCQke2x9LCAkJHtsICsgMX0pYDtcbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbHVtbnNQYXR0ZXJuID0gY29sdW1uc0FycmF5XG4gICAgICAubWFwKChjb2wsIGluZGV4KSA9PiBgJCR7aW5kZXggKyAyfTpuYW1lYClcbiAgICAgIC5qb2luKCk7XG4gICAgY29uc3QgdmFsdWVzUGF0dGVybiA9IGluaXRpYWxWYWx1ZXMuY29uY2F0KGdlb1BvaW50c0luamVjdHMpLmpvaW4oKTtcblxuICAgIGNvbnN0IHFzID0gYElOU0VSVCBJTlRPICQxOm5hbWUgKCR7Y29sdW1uc1BhdHRlcm59KSBWQUxVRVMgKCR7dmFsdWVzUGF0dGVybn0pYDtcbiAgICBjb25zdCB2YWx1ZXMgPSBbY2xhc3NOYW1lLCAuLi5jb2x1bW5zQXJyYXksIC4uLnZhbHVlc0FycmF5XTtcbiAgICBkZWJ1ZyhxcywgdmFsdWVzKTtcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50XG4gICAgICAubm9uZShxcywgdmFsdWVzKVxuICAgICAgLnRoZW4oKCkgPT4gKHsgb3BzOiBbb2JqZWN0XSB9KSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlID09PSBQb3N0Z3Jlc1VuaXF1ZUluZGV4VmlvbGF0aW9uRXJyb3IpIHtcbiAgICAgICAgICBjb25zdCBlcnIgPSBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUsXG4gICAgICAgICAgICAnQSBkdXBsaWNhdGUgdmFsdWUgZm9yIGEgZmllbGQgd2l0aCB1bmlxdWUgdmFsdWVzIHdhcyBwcm92aWRlZCdcbiAgICAgICAgICApO1xuICAgICAgICAgIGVyci51bmRlcmx5aW5nRXJyb3IgPSBlcnJvcjtcbiAgICAgICAgICBpZiAoZXJyb3IuY29uc3RyYWludCkge1xuICAgICAgICAgICAgY29uc3QgbWF0Y2hlcyA9IGVycm9yLmNvbnN0cmFpbnQubWF0Y2goL3VuaXF1ZV8oW2EtekEtWl0rKS8pO1xuICAgICAgICAgICAgaWYgKG1hdGNoZXMgJiYgQXJyYXkuaXNBcnJheShtYXRjaGVzKSkge1xuICAgICAgICAgICAgICBlcnIudXNlckluZm8gPSB7IGR1cGxpY2F0ZWRfZmllbGQ6IG1hdGNoZXNbMV0gfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgZXJyb3IgPSBlcnI7XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KTtcbiAgfVxuXG4gIC8vIFJlbW92ZSBhbGwgb2JqZWN0cyB0aGF0IG1hdGNoIHRoZSBnaXZlbiBQYXJzZSBRdWVyeS5cbiAgLy8gSWYgbm8gb2JqZWN0cyBtYXRjaCwgcmVqZWN0IHdpdGggT0JKRUNUX05PVF9GT1VORC4gSWYgb2JqZWN0cyBhcmUgZm91bmQgYW5kIGRlbGV0ZWQsIHJlc29sdmUgd2l0aCB1bmRlZmluZWQuXG4gIC8vIElmIHRoZXJlIGlzIHNvbWUgb3RoZXIgZXJyb3IsIHJlamVjdCB3aXRoIElOVEVSTkFMX1NFUlZFUl9FUlJPUi5cbiAgZGVsZXRlT2JqZWN0c0J5UXVlcnkoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgc2NoZW1hOiBTY2hlbWFUeXBlLFxuICAgIHF1ZXJ5OiBRdWVyeVR5cGVcbiAgKSB7XG4gICAgZGVidWcoJ2RlbGV0ZU9iamVjdHNCeVF1ZXJ5JywgY2xhc3NOYW1lLCBxdWVyeSk7XG4gICAgY29uc3QgdmFsdWVzID0gW2NsYXNzTmFtZV07XG4gICAgY29uc3QgaW5kZXggPSAyO1xuICAgIGNvbnN0IHdoZXJlID0gYnVpbGRXaGVyZUNsYXVzZSh7IHNjaGVtYSwgaW5kZXgsIHF1ZXJ5IH0pO1xuICAgIHZhbHVlcy5wdXNoKC4uLndoZXJlLnZhbHVlcyk7XG4gICAgaWYgKE9iamVjdC5rZXlzKHF1ZXJ5KS5sZW5ndGggPT09IDApIHtcbiAgICAgIHdoZXJlLnBhdHRlcm4gPSAnVFJVRSc7XG4gICAgfVxuICAgIGNvbnN0IHFzID0gYFdJVEggZGVsZXRlZCBBUyAoREVMRVRFIEZST00gJDE6bmFtZSBXSEVSRSAke1xuICAgICAgd2hlcmUucGF0dGVyblxuICAgIH0gUkVUVVJOSU5HICopIFNFTEVDVCBjb3VudCgqKSBGUk9NIGRlbGV0ZWRgO1xuICAgIGRlYnVnKHFzLCB2YWx1ZXMpO1xuICAgIHJldHVybiB0aGlzLl9jbGllbnRcbiAgICAgIC5vbmUocXMsIHZhbHVlcywgYSA9PiArYS5jb3VudClcbiAgICAgIC50aGVuKGNvdW50ID0+IHtcbiAgICAgICAgaWYgKGNvdW50ID09PSAwKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCxcbiAgICAgICAgICAgICdPYmplY3Qgbm90IGZvdW5kLidcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiBjb3VudDtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlICE9PSBQb3N0Z3Jlc1JlbGF0aW9uRG9lc05vdEV4aXN0RXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgICAvLyBFTFNFOiBEb24ndCBkZWxldGUgYW55dGhpbmcgaWYgZG9lc24ndCBleGlzdFxuICAgICAgfSk7XG4gIH1cbiAgLy8gUmV0dXJuIHZhbHVlIG5vdCBjdXJyZW50bHkgd2VsbCBzcGVjaWZpZWQuXG4gIGZpbmRPbmVBbmRVcGRhdGUoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgc2NoZW1hOiBTY2hlbWFUeXBlLFxuICAgIHF1ZXJ5OiBRdWVyeVR5cGUsXG4gICAgdXBkYXRlOiBhbnlcbiAgKTogUHJvbWlzZTxhbnk+IHtcbiAgICBkZWJ1ZygnZmluZE9uZUFuZFVwZGF0ZScsIGNsYXNzTmFtZSwgcXVlcnksIHVwZGF0ZSk7XG4gICAgcmV0dXJuIHRoaXMudXBkYXRlT2JqZWN0c0J5UXVlcnkoY2xhc3NOYW1lLCBzY2hlbWEsIHF1ZXJ5LCB1cGRhdGUpLnRoZW4oXG4gICAgICB2YWwgPT4gdmFsWzBdXG4gICAgKTtcbiAgfVxuXG4gIC8vIEFwcGx5IHRoZSB1cGRhdGUgdG8gYWxsIG9iamVjdHMgdGhhdCBtYXRjaCB0aGUgZ2l2ZW4gUGFyc2UgUXVlcnkuXG4gIHVwZGF0ZU9iamVjdHNCeVF1ZXJ5KFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIHNjaGVtYTogU2NoZW1hVHlwZSxcbiAgICBxdWVyeTogUXVlcnlUeXBlLFxuICAgIHVwZGF0ZTogYW55XG4gICk6IFByb21pc2U8W2FueV0+IHtcbiAgICBkZWJ1ZygndXBkYXRlT2JqZWN0c0J5UXVlcnknLCBjbGFzc05hbWUsIHF1ZXJ5LCB1cGRhdGUpO1xuICAgIGNvbnN0IHVwZGF0ZVBhdHRlcm5zID0gW107XG4gICAgY29uc3QgdmFsdWVzID0gW2NsYXNzTmFtZV07XG4gICAgbGV0IGluZGV4ID0gMjtcbiAgICBzY2hlbWEgPSB0b1Bvc3RncmVzU2NoZW1hKHNjaGVtYSk7XG5cbiAgICBjb25zdCBvcmlnaW5hbFVwZGF0ZSA9IHsgLi4udXBkYXRlIH07XG5cbiAgICAvLyBTZXQgZmxhZyBmb3IgZG90IG5vdGF0aW9uIGZpZWxkc1xuICAgIGNvbnN0IGRvdE5vdGF0aW9uT3B0aW9ucyA9IHt9O1xuICAgIE9iamVjdC5rZXlzKHVwZGF0ZSkuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgICAgaWYgKGZpZWxkTmFtZS5pbmRleE9mKCcuJykgPiAtMSkge1xuICAgICAgICBjb25zdCBjb21wb25lbnRzID0gZmllbGROYW1lLnNwbGl0KCcuJyk7XG4gICAgICAgIGNvbnN0IGZpcnN0ID0gY29tcG9uZW50cy5zaGlmdCgpO1xuICAgICAgICBkb3ROb3RhdGlvbk9wdGlvbnNbZmlyc3RdID0gdHJ1ZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRvdE5vdGF0aW9uT3B0aW9uc1tmaWVsZE5hbWVdID0gZmFsc2U7XG4gICAgICB9XG4gICAgfSk7XG4gICAgdXBkYXRlID0gaGFuZGxlRG90RmllbGRzKHVwZGF0ZSk7XG4gICAgLy8gUmVzb2x2ZSBhdXRoRGF0YSBmaXJzdCxcbiAgICAvLyBTbyB3ZSBkb24ndCBlbmQgdXAgd2l0aCBtdWx0aXBsZSBrZXkgdXBkYXRlc1xuICAgIGZvciAoY29uc3QgZmllbGROYW1lIGluIHVwZGF0ZSkge1xuICAgICAgY29uc3QgYXV0aERhdGFNYXRjaCA9IGZpZWxkTmFtZS5tYXRjaCgvXl9hdXRoX2RhdGFfKFthLXpBLVowLTlfXSspJC8pO1xuICAgICAgaWYgKGF1dGhEYXRhTWF0Y2gpIHtcbiAgICAgICAgdmFyIHByb3ZpZGVyID0gYXV0aERhdGFNYXRjaFsxXTtcbiAgICAgICAgY29uc3QgdmFsdWUgPSB1cGRhdGVbZmllbGROYW1lXTtcbiAgICAgICAgZGVsZXRlIHVwZGF0ZVtmaWVsZE5hbWVdO1xuICAgICAgICB1cGRhdGVbJ2F1dGhEYXRhJ10gPSB1cGRhdGVbJ2F1dGhEYXRhJ10gfHwge307XG4gICAgICAgIHVwZGF0ZVsnYXV0aERhdGEnXVtwcm92aWRlcl0gPSB2YWx1ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGZpZWxkTmFtZSBpbiB1cGRhdGUpIHtcbiAgICAgIGNvbnN0IGZpZWxkVmFsdWUgPSB1cGRhdGVbZmllbGROYW1lXTtcbiAgICAgIC8vIERyb3AgYW55IHVuZGVmaW5lZCB2YWx1ZXMuXG4gICAgICBpZiAodHlwZW9mIGZpZWxkVmFsdWUgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIGRlbGV0ZSB1cGRhdGVbZmllbGROYW1lXTtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGRWYWx1ZSA9PT0gbnVsbCkge1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9IE5VTExgKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgaW5kZXggKz0gMTtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGROYW1lID09ICdhdXRoRGF0YScpIHtcbiAgICAgICAgLy8gVGhpcyByZWN1cnNpdmVseSBzZXRzIHRoZSBqc29uX29iamVjdFxuICAgICAgICAvLyBPbmx5IDEgbGV2ZWwgZGVlcFxuICAgICAgICBjb25zdCBnZW5lcmF0ZSA9IChqc29uYjogc3RyaW5nLCBrZXk6IHN0cmluZywgdmFsdWU6IGFueSkgPT4ge1xuICAgICAgICAgIHJldHVybiBganNvbl9vYmplY3Rfc2V0X2tleShDT0FMRVNDRSgke2pzb25ifSwgJ3t9Jzo6anNvbmIpLCAke2tleX0sICR7dmFsdWV9KTo6anNvbmJgO1xuICAgICAgICB9O1xuICAgICAgICBjb25zdCBsYXN0S2V5ID0gYCQke2luZGV4fTpuYW1lYDtcbiAgICAgICAgY29uc3QgZmllbGROYW1lSW5kZXggPSBpbmRleDtcbiAgICAgICAgaW5kZXggKz0gMTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgY29uc3QgdXBkYXRlID0gT2JqZWN0LmtleXMoZmllbGRWYWx1ZSkucmVkdWNlKFxuICAgICAgICAgIChsYXN0S2V5OiBzdHJpbmcsIGtleTogc3RyaW5nKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBzdHIgPSBnZW5lcmF0ZShcbiAgICAgICAgICAgICAgbGFzdEtleSxcbiAgICAgICAgICAgICAgYCQke2luZGV4fTo6dGV4dGAsXG4gICAgICAgICAgICAgIGAkJHtpbmRleCArIDF9Ojpqc29uYmBcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBpbmRleCArPSAyO1xuICAgICAgICAgICAgbGV0IHZhbHVlID0gZmllbGRWYWx1ZVtrZXldO1xuICAgICAgICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgICAgICAgIGlmICh2YWx1ZS5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICAgICAgICAgIHZhbHVlID0gbnVsbDtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB2YWx1ZSA9IEpTT04uc3RyaW5naWZ5KHZhbHVlKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmFsdWVzLnB1c2goa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICByZXR1cm4gc3RyO1xuICAgICAgICAgIH0sXG4gICAgICAgICAgbGFzdEtleVxuICAgICAgICApO1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtmaWVsZE5hbWVJbmRleH06bmFtZSA9ICR7dXBkYXRlfWApO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fb3AgPT09ICdJbmNyZW1lbnQnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goXG4gICAgICAgICAgYCQke2luZGV4fTpuYW1lID0gQ09BTEVTQ0UoJCR7aW5kZXh9Om5hbWUsIDApICsgJCR7aW5kZXggKyAxfWBcbiAgICAgICAgKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlLmFtb3VudCk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUuX19vcCA9PT0gJ0FkZCcpIHtcbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChcbiAgICAgICAgICBgJCR7aW5kZXh9Om5hbWUgPSBhcnJheV9hZGQoQ09BTEVTQ0UoJCR7aW5kZXh9Om5hbWUsICdbXSc6Ompzb25iKSwgJCR7aW5kZXggK1xuICAgICAgICAgICAgMX06Ompzb25iKWBcbiAgICAgICAgKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBKU09OLnN0cmluZ2lmeShmaWVsZFZhbHVlLm9iamVjdHMpKTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGRWYWx1ZS5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX1gKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBudWxsKTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGRWYWx1ZS5fX29wID09PSAnUmVtb3ZlJykge1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKFxuICAgICAgICAgIGAkJHtpbmRleH06bmFtZSA9IGFycmF5X3JlbW92ZShDT0FMRVNDRSgkJHtpbmRleH06bmFtZSwgJ1tdJzo6anNvbmIpLCAkJHtpbmRleCArXG4gICAgICAgICAgICAxfTo6anNvbmIpYFxuICAgICAgICApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIEpTT04uc3RyaW5naWZ5KGZpZWxkVmFsdWUub2JqZWN0cykpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fb3AgPT09ICdBZGRVbmlxdWUnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goXG4gICAgICAgICAgYCQke2luZGV4fTpuYW1lID0gYXJyYXlfYWRkX3VuaXF1ZShDT0FMRVNDRSgkJHtpbmRleH06bmFtZSwgJ1tdJzo6anNvbmIpLCAkJHtpbmRleCArXG4gICAgICAgICAgICAxfTo6anNvbmIpYFxuICAgICAgICApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIEpTT04uc3RyaW5naWZ5KGZpZWxkVmFsdWUub2JqZWN0cykpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZE5hbWUgPT09ICd1cGRhdGVkQXQnKSB7XG4gICAgICAgIC8vVE9ETzogc3RvcCBzcGVjaWFsIGNhc2luZyB0aGlzLiBJdCBzaG91bGQgY2hlY2sgZm9yIF9fdHlwZSA9PT0gJ0RhdGUnIGFuZCB1c2UgLmlzb1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX1gKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlKTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGZpZWxkVmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmICh0eXBlb2YgZmllbGRWYWx1ZSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fdHlwZSA9PT0gJ1BvaW50ZXInKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUub2JqZWN0SWQpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fdHlwZSA9PT0gJ0RhdGUnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIHRvUG9zdGdyZXNWYWx1ZShmaWVsZFZhbHVlKSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fdHlwZSA9PT0gJ0ZpbGUnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIHRvUG9zdGdyZXNWYWx1ZShmaWVsZFZhbHVlKSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUuX190eXBlID09PSAnR2VvUG9pbnQnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goXG4gICAgICAgICAgYCQke2luZGV4fTpuYW1lID0gUE9JTlQoJCR7aW5kZXggKyAxfSwgJCR7aW5kZXggKyAyfSlgXG4gICAgICAgICk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZS5sb25naXR1ZGUsIGZpZWxkVmFsdWUubGF0aXR1ZGUpO1xuICAgICAgICBpbmRleCArPSAzO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fdHlwZSA9PT0gJ1BvbHlnb24nKSB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gY29udmVydFBvbHlnb25Ub1NRTChmaWVsZFZhbHVlLmNvb3JkaW5hdGVzKTtcbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9Ojpwb2x5Z29uYCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgdmFsdWUpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fdHlwZSA9PT0gJ1JlbGF0aW9uJykge1xuICAgICAgICAvLyBub29wXG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiBmaWVsZFZhbHVlID09PSAnbnVtYmVyJykge1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX1gKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlKTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgIHR5cGVvZiBmaWVsZFZhbHVlID09PSAnb2JqZWN0JyAmJlxuICAgICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0gJiZcbiAgICAgICAgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdPYmplY3QnXG4gICAgICApIHtcbiAgICAgICAgLy8gR2F0aGVyIGtleXMgdG8gaW5jcmVtZW50XG4gICAgICAgIGNvbnN0IGtleXNUb0luY3JlbWVudCA9IE9iamVjdC5rZXlzKG9yaWdpbmFsVXBkYXRlKVxuICAgICAgICAgIC5maWx0ZXIoayA9PiB7XG4gICAgICAgICAgICAvLyBjaG9vc2UgdG9wIGxldmVsIGZpZWxkcyB0aGF0IGhhdmUgYSBkZWxldGUgb3BlcmF0aW9uIHNldFxuICAgICAgICAgICAgLy8gTm90ZSB0aGF0IE9iamVjdC5rZXlzIGlzIGl0ZXJhdGluZyBvdmVyIHRoZSAqKm9yaWdpbmFsKiogdXBkYXRlIG9iamVjdFxuICAgICAgICAgICAgLy8gYW5kIHRoYXQgc29tZSBvZiB0aGUga2V5cyBvZiB0aGUgb3JpZ2luYWwgdXBkYXRlIGNvdWxkIGJlIG51bGwgb3IgdW5kZWZpbmVkOlxuICAgICAgICAgICAgLy8gKFNlZSB0aGUgYWJvdmUgY2hlY2sgYGlmIChmaWVsZFZhbHVlID09PSBudWxsIHx8IHR5cGVvZiBmaWVsZFZhbHVlID09IFwidW5kZWZpbmVkXCIpYClcbiAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gb3JpZ2luYWxVcGRhdGVba107XG4gICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICB2YWx1ZSAmJlxuICAgICAgICAgICAgICB2YWx1ZS5fX29wID09PSAnSW5jcmVtZW50JyAmJlxuICAgICAgICAgICAgICBrLnNwbGl0KCcuJykubGVuZ3RoID09PSAyICYmXG4gICAgICAgICAgICAgIGsuc3BsaXQoJy4nKVswXSA9PT0gZmllbGROYW1lXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLm1hcChrID0+IGsuc3BsaXQoJy4nKVsxXSk7XG5cbiAgICAgICAgbGV0IGluY3JlbWVudFBhdHRlcm5zID0gJyc7XG4gICAgICAgIGlmIChrZXlzVG9JbmNyZW1lbnQubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGluY3JlbWVudFBhdHRlcm5zID1cbiAgICAgICAgICAgICcgfHwgJyArXG4gICAgICAgICAgICBrZXlzVG9JbmNyZW1lbnRcbiAgICAgICAgICAgICAgLm1hcChjID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBhbW91bnQgPSBmaWVsZFZhbHVlW2NdLmFtb3VudDtcbiAgICAgICAgICAgICAgICByZXR1cm4gYENPTkNBVCgne1wiJHtjfVwiOicsIENPQUxFU0NFKCQke2luZGV4fTpuYW1lLT4+JyR7Y30nLCcwJyk6OmludCArICR7YW1vdW50fSwgJ30nKTo6anNvbmJgO1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAuam9pbignIHx8ICcpO1xuICAgICAgICAgIC8vIFN0cmlwIHRoZSBrZXlzXG4gICAgICAgICAga2V5c1RvSW5jcmVtZW50LmZvckVhY2goa2V5ID0+IHtcbiAgICAgICAgICAgIGRlbGV0ZSBmaWVsZFZhbHVlW2tleV07XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBrZXlzVG9EZWxldGU6IEFycmF5PHN0cmluZz4gPSBPYmplY3Qua2V5cyhvcmlnaW5hbFVwZGF0ZSlcbiAgICAgICAgICAuZmlsdGVyKGsgPT4ge1xuICAgICAgICAgICAgLy8gY2hvb3NlIHRvcCBsZXZlbCBmaWVsZHMgdGhhdCBoYXZlIGEgZGVsZXRlIG9wZXJhdGlvbiBzZXQuXG4gICAgICAgICAgICBjb25zdCB2YWx1ZSA9IG9yaWdpbmFsVXBkYXRlW2tdO1xuICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgdmFsdWUgJiZcbiAgICAgICAgICAgICAgdmFsdWUuX19vcCA9PT0gJ0RlbGV0ZScgJiZcbiAgICAgICAgICAgICAgay5zcGxpdCgnLicpLmxlbmd0aCA9PT0gMiAmJlxuICAgICAgICAgICAgICBrLnNwbGl0KCcuJylbMF0gPT09IGZpZWxkTmFtZVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5tYXAoayA9PiBrLnNwbGl0KCcuJylbMV0pO1xuXG4gICAgICAgIGNvbnN0IGRlbGV0ZVBhdHRlcm5zID0ga2V5c1RvRGVsZXRlLnJlZHVjZShcbiAgICAgICAgICAocDogc3RyaW5nLCBjOiBzdHJpbmcsIGk6IG51bWJlcikgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHAgKyBgIC0gJyQke2luZGV4ICsgMSArIGl9OnZhbHVlJ2A7XG4gICAgICAgICAgfSxcbiAgICAgICAgICAnJ1xuICAgICAgICApO1xuICAgICAgICAvLyBPdmVycmlkZSBPYmplY3RcbiAgICAgICAgbGV0IHVwZGF0ZU9iamVjdCA9IFwiJ3t9Jzo6anNvbmJcIjtcblxuICAgICAgICBpZiAoZG90Tm90YXRpb25PcHRpb25zW2ZpZWxkTmFtZV0pIHtcbiAgICAgICAgICAvLyBNZXJnZSBPYmplY3RcbiAgICAgICAgICB1cGRhdGVPYmplY3QgPSBgQ09BTEVTQ0UoJCR7aW5kZXh9Om5hbWUsICd7fSc6Ompzb25iKWA7XG4gICAgICAgIH1cbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChcbiAgICAgICAgICBgJCR7aW5kZXh9Om5hbWUgPSAoJHt1cGRhdGVPYmplY3R9ICR7ZGVsZXRlUGF0dGVybnN9ICR7aW5jcmVtZW50UGF0dGVybnN9IHx8ICQke2luZGV4ICtcbiAgICAgICAgICAgIDEgK1xuICAgICAgICAgICAga2V5c1RvRGVsZXRlLmxlbmd0aH06Ompzb25iIClgXG4gICAgICAgICk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgLi4ua2V5c1RvRGVsZXRlLCBKU09OLnN0cmluZ2lmeShmaWVsZFZhbHVlKSk7XG4gICAgICAgIGluZGV4ICs9IDIgKyBrZXlzVG9EZWxldGUubGVuZ3RoO1xuICAgICAgfSBlbHNlIGlmIChcbiAgICAgICAgQXJyYXkuaXNBcnJheShmaWVsZFZhbHVlKSAmJlxuICAgICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0gJiZcbiAgICAgICAgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdBcnJheSdcbiAgICAgICkge1xuICAgICAgICBjb25zdCBleHBlY3RlZFR5cGUgPSBwYXJzZVR5cGVUb1Bvc3RncmVzVHlwZShzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0pO1xuICAgICAgICBpZiAoZXhwZWN0ZWRUeXBlID09PSAndGV4dFtdJykge1xuICAgICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfTo6dGV4dFtdYCk7XG4gICAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlKTtcbiAgICAgICAgICBpbmRleCArPSAyO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICAgICAgY29uc3QgYnVpbGRTUUxBcnJheSA9IGZpZWxkVmFsdWUgPT4ge1xuICAgICAgICAgICAgbGV0IHBhdHRlcm4gPSAnanNvbl9idWlsZF9hcnJheSgnO1xuICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBmaWVsZFZhbHVlLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGVsZW1lbnQgPSBmaWVsZFZhbHVlW2ldO1xuICAgICAgICAgICAgICBsZXQgdHlwZSA9ICcnO1xuICAgICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShlbGVtZW50KSkge1xuICAgICAgICAgICAgICAgIHBhdHRlcm4gKz0gYnVpbGRTUUxBcnJheShlbGVtZW50KSArICcsJztcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgZWxlbWVudCA9PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgICAgIHR5cGUgPSAnOjpqc29uJztcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB2YWx1ZXMucHVzaChlbGVtZW50KTtcbiAgICAgICAgICAgICAgcGF0dGVybiArPSBgJCR7aW5kZXggKyAxfSR7dHlwZX0sYDtcbiAgICAgICAgICAgICAgaW5kZXggKz0gMTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIHJlbW92ZSBsYXN0IGNvbW1hXG4gICAgICAgICAgICBpZiAoZmllbGRWYWx1ZS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgIHBhdHRlcm4gPSBwYXR0ZXJuLnNsaWNlKDAsIC0xKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHBhdHRlcm4gKz0gJyknO1xuICAgICAgICAgICAgcmV0dXJuIHBhdHRlcm47XG4gICAgICAgICAgfTtcbiAgICAgICAgICBjb25zdCBzcWwgPSBgJCR7aW5kZXh9Om5hbWUgPSAke2J1aWxkU1FMQXJyYXkoZmllbGRWYWx1ZSl9YDtcblxuICAgICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goc3FsKTtcbiAgICAgICAgICBpbmRleCArPSAxO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkZWJ1ZygnTm90IHN1cHBvcnRlZCB1cGRhdGUnLCBmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QoXG4gICAgICAgICAgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgICAgICAgIGBQb3N0Z3JlcyBkb2Vzbid0IHN1cHBvcnQgdXBkYXRlICR7SlNPTi5zdHJpbmdpZnkoZmllbGRWYWx1ZSl9IHlldGBcbiAgICAgICAgICApXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgd2hlcmUgPSBidWlsZFdoZXJlQ2xhdXNlKHsgc2NoZW1hLCBpbmRleCwgcXVlcnkgfSk7XG4gICAgdmFsdWVzLnB1c2goLi4ud2hlcmUudmFsdWVzKTtcblxuICAgIGNvbnN0IHdoZXJlQ2xhdXNlID1cbiAgICAgIHdoZXJlLnBhdHRlcm4ubGVuZ3RoID4gMCA/IGBXSEVSRSAke3doZXJlLnBhdHRlcm59YCA6ICcnO1xuICAgIGNvbnN0IHFzID0gYFVQREFURSAkMTpuYW1lIFNFVCAke3VwZGF0ZVBhdHRlcm5zLmpvaW4oKX0gJHt3aGVyZUNsYXVzZX0gUkVUVVJOSU5HICpgO1xuICAgIGRlYnVnKCd1cGRhdGU6ICcsIHFzLCB2YWx1ZXMpO1xuICAgIHJldHVybiB0aGlzLl9jbGllbnQuYW55KHFzLCB2YWx1ZXMpO1xuICB9XG5cbiAgLy8gSG9wZWZ1bGx5LCB3ZSBjYW4gZ2V0IHJpZCBvZiB0aGlzLiBJdCdzIG9ubHkgdXNlZCBmb3IgY29uZmlnIGFuZCBob29rcy5cbiAgdXBzZXJ0T25lT2JqZWN0KFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIHNjaGVtYTogU2NoZW1hVHlwZSxcbiAgICBxdWVyeTogUXVlcnlUeXBlLFxuICAgIHVwZGF0ZTogYW55XG4gICkge1xuICAgIGRlYnVnKCd1cHNlcnRPbmVPYmplY3QnLCB7IGNsYXNzTmFtZSwgcXVlcnksIHVwZGF0ZSB9KTtcbiAgICBjb25zdCBjcmVhdGVWYWx1ZSA9IE9iamVjdC5hc3NpZ24oe30sIHF1ZXJ5LCB1cGRhdGUpO1xuICAgIHJldHVybiB0aGlzLmNyZWF0ZU9iamVjdChjbGFzc05hbWUsIHNjaGVtYSwgY3JlYXRlVmFsdWUpLmNhdGNoKGVycm9yID0+IHtcbiAgICAgIC8vIGlnbm9yZSBkdXBsaWNhdGUgdmFsdWUgZXJyb3JzIGFzIGl0J3MgdXBzZXJ0XG4gICAgICBpZiAoZXJyb3IuY29kZSAhPT0gUGFyc2UuRXJyb3IuRFVQTElDQVRFX1ZBTFVFKSB7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXMuZmluZE9uZUFuZFVwZGF0ZShjbGFzc05hbWUsIHNjaGVtYSwgcXVlcnksIHVwZGF0ZSk7XG4gICAgfSk7XG4gIH1cblxuICBmaW5kKFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIHNjaGVtYTogU2NoZW1hVHlwZSxcbiAgICBxdWVyeTogUXVlcnlUeXBlLFxuICAgIHsgc2tpcCwgbGltaXQsIHNvcnQsIGtleXMgfTogUXVlcnlPcHRpb25zXG4gICkge1xuICAgIGRlYnVnKCdmaW5kJywgY2xhc3NOYW1lLCBxdWVyeSwgeyBza2lwLCBsaW1pdCwgc29ydCwga2V5cyB9KTtcbiAgICBjb25zdCBoYXNMaW1pdCA9IGxpbWl0ICE9PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgaGFzU2tpcCA9IHNraXAgIT09IHVuZGVmaW5lZDtcbiAgICBsZXQgdmFsdWVzID0gW2NsYXNzTmFtZV07XG4gICAgY29uc3Qgd2hlcmUgPSBidWlsZFdoZXJlQ2xhdXNlKHsgc2NoZW1hLCBxdWVyeSwgaW5kZXg6IDIgfSk7XG4gICAgdmFsdWVzLnB1c2goLi4ud2hlcmUudmFsdWVzKTtcblxuICAgIGNvbnN0IHdoZXJlUGF0dGVybiA9XG4gICAgICB3aGVyZS5wYXR0ZXJuLmxlbmd0aCA+IDAgPyBgV0hFUkUgJHt3aGVyZS5wYXR0ZXJufWAgOiAnJztcbiAgICBjb25zdCBsaW1pdFBhdHRlcm4gPSBoYXNMaW1pdCA/IGBMSU1JVCAkJHt2YWx1ZXMubGVuZ3RoICsgMX1gIDogJyc7XG4gICAgaWYgKGhhc0xpbWl0KSB7XG4gICAgICB2YWx1ZXMucHVzaChsaW1pdCk7XG4gICAgfVxuICAgIGNvbnN0IHNraXBQYXR0ZXJuID0gaGFzU2tpcCA/IGBPRkZTRVQgJCR7dmFsdWVzLmxlbmd0aCArIDF9YCA6ICcnO1xuICAgIGlmIChoYXNTa2lwKSB7XG4gICAgICB2YWx1ZXMucHVzaChza2lwKTtcbiAgICB9XG5cbiAgICBsZXQgc29ydFBhdHRlcm4gPSAnJztcbiAgICBpZiAoc29ydCkge1xuICAgICAgY29uc3Qgc29ydENvcHk6IGFueSA9IHNvcnQ7XG4gICAgICBjb25zdCBzb3J0aW5nID0gT2JqZWN0LmtleXMoc29ydClcbiAgICAgICAgLm1hcChrZXkgPT4ge1xuICAgICAgICAgIGNvbnN0IHRyYW5zZm9ybUtleSA9IHRyYW5zZm9ybURvdEZpZWxkVG9Db21wb25lbnRzKGtleSkuam9pbignLT4nKTtcbiAgICAgICAgICAvLyBVc2luZyAkaWR4IHBhdHRlcm4gZ2l2ZXM6ICBub24taW50ZWdlciBjb25zdGFudCBpbiBPUkRFUiBCWVxuICAgICAgICAgIGlmIChzb3J0Q29weVtrZXldID09PSAxKSB7XG4gICAgICAgICAgICByZXR1cm4gYCR7dHJhbnNmb3JtS2V5fSBBU0NgO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gYCR7dHJhbnNmb3JtS2V5fSBERVNDYDtcbiAgICAgICAgfSlcbiAgICAgICAgLmpvaW4oKTtcbiAgICAgIHNvcnRQYXR0ZXJuID1cbiAgICAgICAgc29ydCAhPT0gdW5kZWZpbmVkICYmIE9iamVjdC5rZXlzKHNvcnQpLmxlbmd0aCA+IDBcbiAgICAgICAgICA/IGBPUkRFUiBCWSAke3NvcnRpbmd9YFxuICAgICAgICAgIDogJyc7XG4gICAgfVxuICAgIGlmICh3aGVyZS5zb3J0cyAmJiBPYmplY3Qua2V5cygod2hlcmUuc29ydHM6IGFueSkpLmxlbmd0aCA+IDApIHtcbiAgICAgIHNvcnRQYXR0ZXJuID0gYE9SREVSIEJZICR7d2hlcmUuc29ydHMuam9pbigpfWA7XG4gICAgfVxuXG4gICAgbGV0IGNvbHVtbnMgPSAnKic7XG4gICAgaWYgKGtleXMpIHtcbiAgICAgIC8vIEV4Y2x1ZGUgZW1wdHkga2V5c1xuICAgICAgLy8gUmVwbGFjZSBBQ0wgYnkgaXQncyBrZXlzXG4gICAgICBrZXlzID0ga2V5cy5yZWR1Y2UoKG1lbW8sIGtleSkgPT4ge1xuICAgICAgICBpZiAoa2V5ID09PSAnQUNMJykge1xuICAgICAgICAgIG1lbW8ucHVzaCgnX3JwZXJtJyk7XG4gICAgICAgICAgbWVtby5wdXNoKCdfd3Blcm0nKTtcbiAgICAgICAgfSBlbHNlIGlmIChrZXkubGVuZ3RoID4gMCkge1xuICAgICAgICAgIG1lbW8ucHVzaChrZXkpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBtZW1vO1xuICAgICAgfSwgW10pO1xuICAgICAgY29sdW1ucyA9IGtleXNcbiAgICAgICAgLm1hcCgoa2V5LCBpbmRleCkgPT4ge1xuICAgICAgICAgIGlmIChrZXkgPT09ICckc2NvcmUnKSB7XG4gICAgICAgICAgICByZXR1cm4gYHRzX3JhbmtfY2QodG9fdHN2ZWN0b3IoJCR7Mn0sICQkezN9Om5hbWUpLCB0b190c3F1ZXJ5KCQkezR9LCAkJHs1fSksIDMyKSBhcyBzY29yZWA7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBgJCR7aW5kZXggKyB2YWx1ZXMubGVuZ3RoICsgMX06bmFtZWA7XG4gICAgICAgIH0pXG4gICAgICAgIC5qb2luKCk7XG4gICAgICB2YWx1ZXMgPSB2YWx1ZXMuY29uY2F0KGtleXMpO1xuICAgIH1cblxuICAgIGNvbnN0IHFzID0gYFNFTEVDVCAke2NvbHVtbnN9IEZST00gJDE6bmFtZSAke3doZXJlUGF0dGVybn0gJHtzb3J0UGF0dGVybn0gJHtsaW1pdFBhdHRlcm59ICR7c2tpcFBhdHRlcm59YDtcbiAgICBkZWJ1ZyhxcywgdmFsdWVzKTtcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50XG4gICAgICAuYW55KHFzLCB2YWx1ZXMpXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICAvLyBRdWVyeSBvbiBub24gZXhpc3RpbmcgdGFibGUsIGRvbid0IGNyYXNoXG4gICAgICAgIGlmIChlcnJvci5jb2RlICE9PSBQb3N0Z3Jlc1JlbGF0aW9uRG9lc05vdEV4aXN0RXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gW107XG4gICAgICB9KVxuICAgICAgLnRoZW4ocmVzdWx0cyA9PlxuICAgICAgICByZXN1bHRzLm1hcChvYmplY3QgPT5cbiAgICAgICAgICB0aGlzLnBvc3RncmVzT2JqZWN0VG9QYXJzZU9iamVjdChjbGFzc05hbWUsIG9iamVjdCwgc2NoZW1hKVxuICAgICAgICApXG4gICAgICApO1xuICB9XG5cbiAgLy8gQ29udmVydHMgZnJvbSBhIHBvc3RncmVzLWZvcm1hdCBvYmplY3QgdG8gYSBSRVNULWZvcm1hdCBvYmplY3QuXG4gIC8vIERvZXMgbm90IHN0cmlwIG91dCBhbnl0aGluZyBiYXNlZCBvbiBhIGxhY2sgb2YgYXV0aGVudGljYXRpb24uXG4gIHBvc3RncmVzT2JqZWN0VG9QYXJzZU9iamVjdChjbGFzc05hbWU6IHN0cmluZywgb2JqZWN0OiBhbnksIHNjaGVtYTogYW55KSB7XG4gICAgT2JqZWN0LmtleXMoc2NoZW1hLmZpZWxkcykuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgICAgaWYgKHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnUG9pbnRlcicgJiYgb2JqZWN0W2ZpZWxkTmFtZV0pIHtcbiAgICAgICAgb2JqZWN0W2ZpZWxkTmFtZV0gPSB7XG4gICAgICAgICAgb2JqZWN0SWQ6IG9iamVjdFtmaWVsZE5hbWVdLFxuICAgICAgICAgIF9fdHlwZTogJ1BvaW50ZXInLFxuICAgICAgICAgIGNsYXNzTmFtZTogc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnRhcmdldENsYXNzLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgaWYgKHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnUmVsYXRpb24nKSB7XG4gICAgICAgIG9iamVjdFtmaWVsZE5hbWVdID0ge1xuICAgICAgICAgIF9fdHlwZTogJ1JlbGF0aW9uJyxcbiAgICAgICAgICBjbGFzc05hbWU6IHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50YXJnZXRDbGFzcyxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGlmIChvYmplY3RbZmllbGROYW1lXSAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ0dlb1BvaW50Jykge1xuICAgICAgICBvYmplY3RbZmllbGROYW1lXSA9IHtcbiAgICAgICAgICBfX3R5cGU6ICdHZW9Qb2ludCcsXG4gICAgICAgICAgbGF0aXR1ZGU6IG9iamVjdFtmaWVsZE5hbWVdLnksXG4gICAgICAgICAgbG9uZ2l0dWRlOiBvYmplY3RbZmllbGROYW1lXS54LFxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgaWYgKG9iamVjdFtmaWVsZE5hbWVdICYmIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnUG9seWdvbicpIHtcbiAgICAgICAgbGV0IGNvb3JkcyA9IG9iamVjdFtmaWVsZE5hbWVdO1xuICAgICAgICBjb29yZHMgPSBjb29yZHMuc3Vic3RyKDIsIGNvb3Jkcy5sZW5ndGggLSA0KS5zcGxpdCgnKSwoJyk7XG4gICAgICAgIGNvb3JkcyA9IGNvb3Jkcy5tYXAocG9pbnQgPT4ge1xuICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICBwYXJzZUZsb2F0KHBvaW50LnNwbGl0KCcsJylbMV0pLFxuICAgICAgICAgICAgcGFyc2VGbG9hdChwb2ludC5zcGxpdCgnLCcpWzBdKSxcbiAgICAgICAgICBdO1xuICAgICAgICB9KTtcbiAgICAgICAgb2JqZWN0W2ZpZWxkTmFtZV0gPSB7XG4gICAgICAgICAgX190eXBlOiAnUG9seWdvbicsXG4gICAgICAgICAgY29vcmRpbmF0ZXM6IGNvb3JkcyxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGlmIChvYmplY3RbZmllbGROYW1lXSAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ0ZpbGUnKSB7XG4gICAgICAgIG9iamVjdFtmaWVsZE5hbWVdID0ge1xuICAgICAgICAgIF9fdHlwZTogJ0ZpbGUnLFxuICAgICAgICAgIG5hbWU6IG9iamVjdFtmaWVsZE5hbWVdLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH0pO1xuICAgIC8vVE9ETzogcmVtb3ZlIHRoaXMgcmVsaWFuY2Ugb24gdGhlIG1vbmdvIGZvcm1hdC4gREIgYWRhcHRlciBzaG91bGRuJ3Qga25vdyB0aGVyZSBpcyBhIGRpZmZlcmVuY2UgYmV0d2VlbiBjcmVhdGVkIGF0IGFuZCBhbnkgb3RoZXIgZGF0ZSBmaWVsZC5cbiAgICBpZiAob2JqZWN0LmNyZWF0ZWRBdCkge1xuICAgICAgb2JqZWN0LmNyZWF0ZWRBdCA9IG9iamVjdC5jcmVhdGVkQXQudG9JU09TdHJpbmcoKTtcbiAgICB9XG4gICAgaWYgKG9iamVjdC51cGRhdGVkQXQpIHtcbiAgICAgIG9iamVjdC51cGRhdGVkQXQgPSBvYmplY3QudXBkYXRlZEF0LnRvSVNPU3RyaW5nKCk7XG4gICAgfVxuICAgIGlmIChvYmplY3QuZXhwaXJlc0F0KSB7XG4gICAgICBvYmplY3QuZXhwaXJlc0F0ID0ge1xuICAgICAgICBfX3R5cGU6ICdEYXRlJyxcbiAgICAgICAgaXNvOiBvYmplY3QuZXhwaXJlc0F0LnRvSVNPU3RyaW5nKCksXG4gICAgICB9O1xuICAgIH1cbiAgICBpZiAob2JqZWN0Ll9lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdCkge1xuICAgICAgb2JqZWN0Ll9lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdCA9IHtcbiAgICAgICAgX190eXBlOiAnRGF0ZScsXG4gICAgICAgIGlzbzogb2JqZWN0Ll9lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdC50b0lTT1N0cmluZygpLFxuICAgICAgfTtcbiAgICB9XG4gICAgaWYgKG9iamVjdC5fYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQpIHtcbiAgICAgIG9iamVjdC5fYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQgPSB7XG4gICAgICAgIF9fdHlwZTogJ0RhdGUnLFxuICAgICAgICBpc286IG9iamVjdC5fYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQudG9JU09TdHJpbmcoKSxcbiAgICAgIH07XG4gICAgfVxuICAgIGlmIChvYmplY3QuX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCkge1xuICAgICAgb2JqZWN0Ll9wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQgPSB7XG4gICAgICAgIF9fdHlwZTogJ0RhdGUnLFxuICAgICAgICBpc286IG9iamVjdC5fcGVyaXNoYWJsZV90b2tlbl9leHBpcmVzX2F0LnRvSVNPU3RyaW5nKCksXG4gICAgICB9O1xuICAgIH1cbiAgICBpZiAob2JqZWN0Ll9wYXNzd29yZF9jaGFuZ2VkX2F0KSB7XG4gICAgICBvYmplY3QuX3Bhc3N3b3JkX2NoYW5nZWRfYXQgPSB7XG4gICAgICAgIF9fdHlwZTogJ0RhdGUnLFxuICAgICAgICBpc286IG9iamVjdC5fcGFzc3dvcmRfY2hhbmdlZF9hdC50b0lTT1N0cmluZygpLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGZpZWxkTmFtZSBpbiBvYmplY3QpIHtcbiAgICAgIGlmIChvYmplY3RbZmllbGROYW1lXSA9PT0gbnVsbCkge1xuICAgICAgICBkZWxldGUgb2JqZWN0W2ZpZWxkTmFtZV07XG4gICAgICB9XG4gICAgICBpZiAob2JqZWN0W2ZpZWxkTmFtZV0gaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICAgIG9iamVjdFtmaWVsZE5hbWVdID0ge1xuICAgICAgICAgIF9fdHlwZTogJ0RhdGUnLFxuICAgICAgICAgIGlzbzogb2JqZWN0W2ZpZWxkTmFtZV0udG9JU09TdHJpbmcoKSxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gb2JqZWN0O1xuICB9XG5cbiAgLy8gQ3JlYXRlIGEgdW5pcXVlIGluZGV4LiBVbmlxdWUgaW5kZXhlcyBvbiBudWxsYWJsZSBmaWVsZHMgYXJlIG5vdCBhbGxvd2VkLiBTaW5jZSB3ZSBkb24ndFxuICAvLyBjdXJyZW50bHkga25vdyB3aGljaCBmaWVsZHMgYXJlIG51bGxhYmxlIGFuZCB3aGljaCBhcmVuJ3QsIHdlIGlnbm9yZSB0aGF0IGNyaXRlcmlhLlxuICAvLyBBcyBzdWNoLCB3ZSBzaG91bGRuJ3QgZXhwb3NlIHRoaXMgZnVuY3Rpb24gdG8gdXNlcnMgb2YgcGFyc2UgdW50aWwgd2UgaGF2ZSBhbiBvdXQtb2YtYmFuZFxuICAvLyBXYXkgb2YgZGV0ZXJtaW5pbmcgaWYgYSBmaWVsZCBpcyBudWxsYWJsZS4gVW5kZWZpbmVkIGRvZXNuJ3QgY291bnQgYWdhaW5zdCB1bmlxdWVuZXNzLFxuICAvLyB3aGljaCBpcyB3aHkgd2UgdXNlIHNwYXJzZSBpbmRleGVzLlxuICBlbnN1cmVVbmlxdWVuZXNzKFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIHNjaGVtYTogU2NoZW1hVHlwZSxcbiAgICBmaWVsZE5hbWVzOiBzdHJpbmdbXVxuICApIHtcbiAgICAvLyBVc2UgdGhlIHNhbWUgbmFtZSBmb3IgZXZlcnkgZW5zdXJlVW5pcXVlbmVzcyBhdHRlbXB0LCBiZWNhdXNlIHBvc3RncmVzXG4gICAgLy8gV2lsbCBoYXBwaWx5IGNyZWF0ZSB0aGUgc2FtZSBpbmRleCB3aXRoIG11bHRpcGxlIG5hbWVzLlxuICAgIGNvbnN0IGNvbnN0cmFpbnROYW1lID0gYHVuaXF1ZV8ke2ZpZWxkTmFtZXMuc29ydCgpLmpvaW4oJ18nKX1gO1xuICAgIGNvbnN0IGNvbnN0cmFpbnRQYXR0ZXJucyA9IGZpZWxkTmFtZXMubWFwKFxuICAgICAgKGZpZWxkTmFtZSwgaW5kZXgpID0+IGAkJHtpbmRleCArIDN9Om5hbWVgXG4gICAgKTtcbiAgICBjb25zdCBxcyA9IGBBTFRFUiBUQUJMRSAkMTpuYW1lIEFERCBDT05TVFJBSU5UICQyOm5hbWUgVU5JUVVFICgke2NvbnN0cmFpbnRQYXR0ZXJucy5qb2luKCl9KWA7XG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudFxuICAgICAgLm5vbmUocXMsIFtjbGFzc05hbWUsIGNvbnN0cmFpbnROYW1lLCAuLi5maWVsZE5hbWVzXSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChcbiAgICAgICAgICBlcnJvci5jb2RlID09PSBQb3N0Z3Jlc0R1cGxpY2F0ZVJlbGF0aW9uRXJyb3IgJiZcbiAgICAgICAgICBlcnJvci5tZXNzYWdlLmluY2x1ZGVzKGNvbnN0cmFpbnROYW1lKVxuICAgICAgICApIHtcbiAgICAgICAgICAvLyBJbmRleCBhbHJlYWR5IGV4aXN0cy4gSWdub3JlIGVycm9yLlxuICAgICAgICB9IGVsc2UgaWYgKFxuICAgICAgICAgIGVycm9yLmNvZGUgPT09IFBvc3RncmVzVW5pcXVlSW5kZXhWaW9sYXRpb25FcnJvciAmJlxuICAgICAgICAgIGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoY29uc3RyYWludE5hbWUpXG4gICAgICAgICkge1xuICAgICAgICAgIC8vIENhc3QgdGhlIGVycm9yIGludG8gdGhlIHByb3BlciBwYXJzZSBlcnJvclxuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLkRVUExJQ0FURV9WQUxVRSxcbiAgICAgICAgICAgICdBIGR1cGxpY2F0ZSB2YWx1ZSBmb3IgYSBmaWVsZCB3aXRoIHVuaXF1ZSB2YWx1ZXMgd2FzIHByb3ZpZGVkJ1xuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9XG5cbiAgLy8gRXhlY3V0ZXMgYSBjb3VudC5cbiAgY291bnQoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgcXVlcnk6IFF1ZXJ5VHlwZSkge1xuICAgIGRlYnVnKCdjb3VudCcsIGNsYXNzTmFtZSwgcXVlcnkpO1xuICAgIGNvbnN0IHZhbHVlcyA9IFtjbGFzc05hbWVdO1xuICAgIGNvbnN0IHdoZXJlID0gYnVpbGRXaGVyZUNsYXVzZSh7IHNjaGVtYSwgcXVlcnksIGluZGV4OiAyIH0pO1xuICAgIHZhbHVlcy5wdXNoKC4uLndoZXJlLnZhbHVlcyk7XG5cbiAgICBjb25zdCB3aGVyZVBhdHRlcm4gPVxuICAgICAgd2hlcmUucGF0dGVybi5sZW5ndGggPiAwID8gYFdIRVJFICR7d2hlcmUucGF0dGVybn1gIDogJyc7XG4gICAgY29uc3QgcXMgPSBgU0VMRUNUIGNvdW50KCopIEZST00gJDE6bmFtZSAke3doZXJlUGF0dGVybn1gO1xuICAgIHJldHVybiB0aGlzLl9jbGllbnRcbiAgICAgIC5vbmUocXMsIHZhbHVlcywgYSA9PiArYS5jb3VudClcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlICE9PSBQb3N0Z3Jlc1JlbGF0aW9uRG9lc05vdEV4aXN0RXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gMDtcbiAgICAgIH0pO1xuICB9XG5cbiAgZGlzdGluY3QoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgc2NoZW1hOiBTY2hlbWFUeXBlLFxuICAgIHF1ZXJ5OiBRdWVyeVR5cGUsXG4gICAgZmllbGROYW1lOiBzdHJpbmdcbiAgKSB7XG4gICAgZGVidWcoJ2Rpc3RpbmN0JywgY2xhc3NOYW1lLCBxdWVyeSk7XG4gICAgbGV0IGZpZWxkID0gZmllbGROYW1lO1xuICAgIGxldCBjb2x1bW4gPSBmaWVsZE5hbWU7XG4gICAgY29uc3QgaXNOZXN0ZWQgPSBmaWVsZE5hbWUuaW5kZXhPZignLicpID49IDA7XG4gICAgaWYgKGlzTmVzdGVkKSB7XG4gICAgICBmaWVsZCA9IHRyYW5zZm9ybURvdEZpZWxkVG9Db21wb25lbnRzKGZpZWxkTmFtZSkuam9pbignLT4nKTtcbiAgICAgIGNvbHVtbiA9IGZpZWxkTmFtZS5zcGxpdCgnLicpWzBdO1xuICAgIH1cbiAgICBjb25zdCBpc0FycmF5RmllbGQgPVxuICAgICAgc2NoZW1hLmZpZWxkcyAmJlxuICAgICAgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdICYmXG4gICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ0FycmF5JztcbiAgICBjb25zdCBpc1BvaW50ZXJGaWVsZCA9XG4gICAgICBzY2hlbWEuZmllbGRzICYmXG4gICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0gJiZcbiAgICAgIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnUG9pbnRlcic7XG4gICAgY29uc3QgdmFsdWVzID0gW2ZpZWxkLCBjb2x1bW4sIGNsYXNzTmFtZV07XG4gICAgY29uc3Qgd2hlcmUgPSBidWlsZFdoZXJlQ2xhdXNlKHsgc2NoZW1hLCBxdWVyeSwgaW5kZXg6IDQgfSk7XG4gICAgdmFsdWVzLnB1c2goLi4ud2hlcmUudmFsdWVzKTtcblxuICAgIGNvbnN0IHdoZXJlUGF0dGVybiA9XG4gICAgICB3aGVyZS5wYXR0ZXJuLmxlbmd0aCA+IDAgPyBgV0hFUkUgJHt3aGVyZS5wYXR0ZXJufWAgOiAnJztcbiAgICBjb25zdCB0cmFuc2Zvcm1lciA9IGlzQXJyYXlGaWVsZCA/ICdqc29uYl9hcnJheV9lbGVtZW50cycgOiAnT04nO1xuICAgIGxldCBxcyA9IGBTRUxFQ1QgRElTVElOQ1QgJHt0cmFuc2Zvcm1lcn0oJDE6bmFtZSkgJDI6bmFtZSBGUk9NICQzOm5hbWUgJHt3aGVyZVBhdHRlcm59YDtcbiAgICBpZiAoaXNOZXN0ZWQpIHtcbiAgICAgIHFzID0gYFNFTEVDVCBESVNUSU5DVCAke3RyYW5zZm9ybWVyfSgkMTpyYXcpICQyOnJhdyBGUk9NICQzOm5hbWUgJHt3aGVyZVBhdHRlcm59YDtcbiAgICB9XG4gICAgZGVidWcocXMsIHZhbHVlcyk7XG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudFxuICAgICAgLmFueShxcywgdmFsdWVzKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yLmNvZGUgPT09IFBvc3RncmVzTWlzc2luZ0NvbHVtbkVycm9yKSB7XG4gICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSlcbiAgICAgIC50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgICBpZiAoIWlzTmVzdGVkKSB7XG4gICAgICAgICAgcmVzdWx0cyA9IHJlc3VsdHMuZmlsdGVyKG9iamVjdCA9PiBvYmplY3RbZmllbGRdICE9PSBudWxsKTtcbiAgICAgICAgICByZXR1cm4gcmVzdWx0cy5tYXAob2JqZWN0ID0+IHtcbiAgICAgICAgICAgIGlmICghaXNQb2ludGVyRmllbGQpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIG9iamVjdFtmaWVsZF07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICBfX3R5cGU6ICdQb2ludGVyJyxcbiAgICAgICAgICAgICAgY2xhc3NOYW1lOiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udGFyZ2V0Q2xhc3MsXG4gICAgICAgICAgICAgIG9iamVjdElkOiBvYmplY3RbZmllbGRdLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBjaGlsZCA9IGZpZWxkTmFtZS5zcGxpdCgnLicpWzFdO1xuICAgICAgICByZXR1cm4gcmVzdWx0cy5tYXAob2JqZWN0ID0+IG9iamVjdFtjb2x1bW5dW2NoaWxkXSk7XG4gICAgICB9KVxuICAgICAgLnRoZW4ocmVzdWx0cyA9PlxuICAgICAgICByZXN1bHRzLm1hcChvYmplY3QgPT5cbiAgICAgICAgICB0aGlzLnBvc3RncmVzT2JqZWN0VG9QYXJzZU9iamVjdChjbGFzc05hbWUsIG9iamVjdCwgc2NoZW1hKVxuICAgICAgICApXG4gICAgICApO1xuICB9XG5cbiAgYWdncmVnYXRlKGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IGFueSwgcGlwZWxpbmU6IGFueSkge1xuICAgIGRlYnVnKCdhZ2dyZWdhdGUnLCBjbGFzc05hbWUsIHBpcGVsaW5lKTtcbiAgICBjb25zdCB2YWx1ZXMgPSBbY2xhc3NOYW1lXTtcbiAgICBsZXQgaW5kZXg6IG51bWJlciA9IDI7XG4gICAgbGV0IGNvbHVtbnM6IHN0cmluZ1tdID0gW107XG4gICAgbGV0IGNvdW50RmllbGQgPSBudWxsO1xuICAgIGxldCBncm91cFZhbHVlcyA9IG51bGw7XG4gICAgbGV0IHdoZXJlUGF0dGVybiA9ICcnO1xuICAgIGxldCBsaW1pdFBhdHRlcm4gPSAnJztcbiAgICBsZXQgc2tpcFBhdHRlcm4gPSAnJztcbiAgICBsZXQgc29ydFBhdHRlcm4gPSAnJztcbiAgICBsZXQgZ3JvdXBQYXR0ZXJuID0gJyc7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwaXBlbGluZS5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgY29uc3Qgc3RhZ2UgPSBwaXBlbGluZVtpXTtcbiAgICAgIGlmIChzdGFnZS4kZ3JvdXApIHtcbiAgICAgICAgZm9yIChjb25zdCBmaWVsZCBpbiBzdGFnZS4kZ3JvdXApIHtcbiAgICAgICAgICBjb25zdCB2YWx1ZSA9IHN0YWdlLiRncm91cFtmaWVsZF07XG4gICAgICAgICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoZmllbGQgPT09ICdfaWQnICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycgJiYgdmFsdWUgIT09ICcnKSB7XG4gICAgICAgICAgICBjb2x1bW5zLnB1c2goYCQke2luZGV4fTpuYW1lIEFTIFwib2JqZWN0SWRcImApO1xuICAgICAgICAgICAgZ3JvdXBQYXR0ZXJuID0gYEdST1VQIEJZICQke2luZGV4fTpuYW1lYDtcbiAgICAgICAgICAgIHZhbHVlcy5wdXNoKHRyYW5zZm9ybUFnZ3JlZ2F0ZUZpZWxkKHZhbHVlKSk7XG4gICAgICAgICAgICBpbmRleCArPSAxO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgIGZpZWxkID09PSAnX2lkJyAmJlxuICAgICAgICAgICAgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJlxuICAgICAgICAgICAgT2JqZWN0LmtleXModmFsdWUpLmxlbmd0aCAhPT0gMFxuICAgICAgICAgICkge1xuICAgICAgICAgICAgZ3JvdXBWYWx1ZXMgPSB2YWx1ZTtcbiAgICAgICAgICAgIGNvbnN0IGdyb3VwQnlGaWVsZHMgPSBbXTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgYWxpYXMgaW4gdmFsdWUpIHtcbiAgICAgICAgICAgICAgY29uc3Qgb3BlcmF0aW9uID0gT2JqZWN0LmtleXModmFsdWVbYWxpYXNdKVswXTtcbiAgICAgICAgICAgICAgY29uc3Qgc291cmNlID0gdHJhbnNmb3JtQWdncmVnYXRlRmllbGQodmFsdWVbYWxpYXNdW29wZXJhdGlvbl0pO1xuICAgICAgICAgICAgICBpZiAobW9uZ29BZ2dyZWdhdGVUb1Bvc3RncmVzW29wZXJhdGlvbl0pIHtcbiAgICAgICAgICAgICAgICBpZiAoIWdyb3VwQnlGaWVsZHMuaW5jbHVkZXMoYFwiJHtzb3VyY2V9XCJgKSkge1xuICAgICAgICAgICAgICAgICAgZ3JvdXBCeUZpZWxkcy5wdXNoKGBcIiR7c291cmNlfVwiYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNvbHVtbnMucHVzaChcbiAgICAgICAgICAgICAgICAgIGBFWFRSQUNUKCR7XG4gICAgICAgICAgICAgICAgICAgIG1vbmdvQWdncmVnYXRlVG9Qb3N0Z3Jlc1tvcGVyYXRpb25dXG4gICAgICAgICAgICAgICAgICB9IEZST00gJCR7aW5kZXh9Om5hbWUgQVQgVElNRSBaT05FICdVVEMnKSBBUyAkJHtpbmRleCArXG4gICAgICAgICAgICAgICAgICAgIDF9Om5hbWVgXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICB2YWx1ZXMucHVzaChzb3VyY2UsIGFsaWFzKTtcbiAgICAgICAgICAgICAgICBpbmRleCArPSAyO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBncm91cFBhdHRlcm4gPSBgR1JPVVAgQlkgJCR7aW5kZXh9OnJhd2A7XG4gICAgICAgICAgICB2YWx1ZXMucHVzaChncm91cEJ5RmllbGRzLmpvaW4oKSk7XG4gICAgICAgICAgICBpbmRleCArPSAxO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICBpZiAodmFsdWUuJHN1bSkge1xuICAgICAgICAgICAgICBpZiAodHlwZW9mIHZhbHVlLiRzdW0gPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgY29sdW1ucy5wdXNoKGBTVU0oJCR7aW5kZXh9Om5hbWUpIEFTICQke2luZGV4ICsgMX06bmFtZWApO1xuICAgICAgICAgICAgICAgIHZhbHVlcy5wdXNoKHRyYW5zZm9ybUFnZ3JlZ2F0ZUZpZWxkKHZhbHVlLiRzdW0pLCBmaWVsZCk7XG4gICAgICAgICAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb3VudEZpZWxkID0gZmllbGQ7XG4gICAgICAgICAgICAgICAgY29sdW1ucy5wdXNoKGBDT1VOVCgqKSBBUyAkJHtpbmRleH06bmFtZWApO1xuICAgICAgICAgICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkKTtcbiAgICAgICAgICAgICAgICBpbmRleCArPSAxO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodmFsdWUuJG1heCkge1xuICAgICAgICAgICAgICBjb2x1bW5zLnB1c2goYE1BWCgkJHtpbmRleH06bmFtZSkgQVMgJCR7aW5kZXggKyAxfTpuYW1lYCk7XG4gICAgICAgICAgICAgIHZhbHVlcy5wdXNoKHRyYW5zZm9ybUFnZ3JlZ2F0ZUZpZWxkKHZhbHVlLiRtYXgpLCBmaWVsZCk7XG4gICAgICAgICAgICAgIGluZGV4ICs9IDI7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodmFsdWUuJG1pbikge1xuICAgICAgICAgICAgICBjb2x1bW5zLnB1c2goYE1JTigkJHtpbmRleH06bmFtZSkgQVMgJCR7aW5kZXggKyAxfTpuYW1lYCk7XG4gICAgICAgICAgICAgIHZhbHVlcy5wdXNoKHRyYW5zZm9ybUFnZ3JlZ2F0ZUZpZWxkKHZhbHVlLiRtaW4pLCBmaWVsZCk7XG4gICAgICAgICAgICAgIGluZGV4ICs9IDI7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodmFsdWUuJGF2Zykge1xuICAgICAgICAgICAgICBjb2x1bW5zLnB1c2goYEFWRygkJHtpbmRleH06bmFtZSkgQVMgJCR7aW5kZXggKyAxfTpuYW1lYCk7XG4gICAgICAgICAgICAgIHZhbHVlcy5wdXNoKHRyYW5zZm9ybUFnZ3JlZ2F0ZUZpZWxkKHZhbHVlLiRhdmcpLCBmaWVsZCk7XG4gICAgICAgICAgICAgIGluZGV4ICs9IDI7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb2x1bW5zLnB1c2goJyonKTtcbiAgICAgIH1cbiAgICAgIGlmIChzdGFnZS4kcHJvamVjdCkge1xuICAgICAgICBpZiAoY29sdW1ucy5pbmNsdWRlcygnKicpKSB7XG4gICAgICAgICAgY29sdW1ucyA9IFtdO1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgZmllbGQgaW4gc3RhZ2UuJHByb2plY3QpIHtcbiAgICAgICAgICBjb25zdCB2YWx1ZSA9IHN0YWdlLiRwcm9qZWN0W2ZpZWxkXTtcbiAgICAgICAgICBpZiAodmFsdWUgPT09IDEgfHwgdmFsdWUgPT09IHRydWUpIHtcbiAgICAgICAgICAgIGNvbHVtbnMucHVzaChgJCR7aW5kZXh9Om5hbWVgKTtcbiAgICAgICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkKTtcbiAgICAgICAgICAgIGluZGV4ICs9IDE7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoc3RhZ2UuJG1hdGNoKSB7XG4gICAgICAgIGNvbnN0IHBhdHRlcm5zID0gW107XG4gICAgICAgIGNvbnN0IG9yT3JBbmQgPSBzdGFnZS4kbWF0Y2guaGFzT3duUHJvcGVydHkoJyRvcicpID8gJyBPUiAnIDogJyBBTkQgJztcblxuICAgICAgICBpZiAoc3RhZ2UuJG1hdGNoLiRvcikge1xuICAgICAgICAgIGNvbnN0IGNvbGxhcHNlID0ge307XG4gICAgICAgICAgc3RhZ2UuJG1hdGNoLiRvci5mb3JFYWNoKGVsZW1lbnQgPT4ge1xuICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gZWxlbWVudCkge1xuICAgICAgICAgICAgICBjb2xsYXBzZVtrZXldID0gZWxlbWVudFtrZXldO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICAgIHN0YWdlLiRtYXRjaCA9IGNvbGxhcHNlO1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgZmllbGQgaW4gc3RhZ2UuJG1hdGNoKSB7XG4gICAgICAgICAgY29uc3QgdmFsdWUgPSBzdGFnZS4kbWF0Y2hbZmllbGRdO1xuICAgICAgICAgIGNvbnN0IG1hdGNoUGF0dGVybnMgPSBbXTtcbiAgICAgICAgICBPYmplY3Qua2V5cyhQYXJzZVRvUG9zZ3Jlc0NvbXBhcmF0b3IpLmZvckVhY2goY21wID0+IHtcbiAgICAgICAgICAgIGlmICh2YWx1ZVtjbXBdKSB7XG4gICAgICAgICAgICAgIGNvbnN0IHBnQ29tcGFyYXRvciA9IFBhcnNlVG9Qb3NncmVzQ29tcGFyYXRvcltjbXBdO1xuICAgICAgICAgICAgICBtYXRjaFBhdHRlcm5zLnB1c2goXG4gICAgICAgICAgICAgICAgYCQke2luZGV4fTpuYW1lICR7cGdDb21wYXJhdG9yfSAkJHtpbmRleCArIDF9YFxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICB2YWx1ZXMucHVzaChmaWVsZCwgdG9Qb3N0Z3Jlc1ZhbHVlKHZhbHVlW2NtcF0pKTtcbiAgICAgICAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgICBpZiAobWF0Y2hQYXR0ZXJucy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAoJHttYXRjaFBhdHRlcm5zLmpvaW4oJyBBTkQgJyl9KWApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoXG4gICAgICAgICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkXSAmJlxuICAgICAgICAgICAgc2NoZW1hLmZpZWxkc1tmaWVsZF0udHlwZSAmJlxuICAgICAgICAgICAgbWF0Y2hQYXR0ZXJucy5sZW5ndGggPT09IDBcbiAgICAgICAgICApIHtcbiAgICAgICAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICAgICAgdmFsdWVzLnB1c2goZmllbGQsIHZhbHVlKTtcbiAgICAgICAgICAgIGluZGV4ICs9IDI7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHdoZXJlUGF0dGVybiA9XG4gICAgICAgICAgcGF0dGVybnMubGVuZ3RoID4gMCA/IGBXSEVSRSAke3BhdHRlcm5zLmpvaW4oYCAke29yT3JBbmR9IGApfWAgOiAnJztcbiAgICAgIH1cbiAgICAgIGlmIChzdGFnZS4kbGltaXQpIHtcbiAgICAgICAgbGltaXRQYXR0ZXJuID0gYExJTUlUICQke2luZGV4fWA7XG4gICAgICAgIHZhbHVlcy5wdXNoKHN0YWdlLiRsaW1pdCk7XG4gICAgICAgIGluZGV4ICs9IDE7XG4gICAgICB9XG4gICAgICBpZiAoc3RhZ2UuJHNraXApIHtcbiAgICAgICAgc2tpcFBhdHRlcm4gPSBgT0ZGU0VUICQke2luZGV4fWA7XG4gICAgICAgIHZhbHVlcy5wdXNoKHN0YWdlLiRza2lwKTtcbiAgICAgICAgaW5kZXggKz0gMTtcbiAgICAgIH1cbiAgICAgIGlmIChzdGFnZS4kc29ydCkge1xuICAgICAgICBjb25zdCBzb3J0ID0gc3RhZ2UuJHNvcnQ7XG4gICAgICAgIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhzb3J0KTtcbiAgICAgICAgY29uc3Qgc29ydGluZyA9IGtleXNcbiAgICAgICAgICAubWFwKGtleSA9PiB7XG4gICAgICAgICAgICBjb25zdCB0cmFuc2Zvcm1lciA9IHNvcnRba2V5XSA9PT0gMSA/ICdBU0MnIDogJ0RFU0MnO1xuICAgICAgICAgICAgY29uc3Qgb3JkZXIgPSBgJCR7aW5kZXh9Om5hbWUgJHt0cmFuc2Zvcm1lcn1gO1xuICAgICAgICAgICAgaW5kZXggKz0gMTtcbiAgICAgICAgICAgIHJldHVybiBvcmRlcjtcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5qb2luKCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKC4uLmtleXMpO1xuICAgICAgICBzb3J0UGF0dGVybiA9XG4gICAgICAgICAgc29ydCAhPT0gdW5kZWZpbmVkICYmIHNvcnRpbmcubGVuZ3RoID4gMCA/IGBPUkRFUiBCWSAke3NvcnRpbmd9YCA6ICcnO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHFzID0gYFNFTEVDVCAke2NvbHVtbnMuam9pbigpfSBGUk9NICQxOm5hbWUgJHt3aGVyZVBhdHRlcm59ICR7c29ydFBhdHRlcm59ICR7bGltaXRQYXR0ZXJufSAke3NraXBQYXR0ZXJufSAke2dyb3VwUGF0dGVybn1gO1xuICAgIGRlYnVnKHFzLCB2YWx1ZXMpO1xuICAgIHJldHVybiB0aGlzLl9jbGllbnRcbiAgICAgIC5tYXAocXMsIHZhbHVlcywgYSA9PlxuICAgICAgICB0aGlzLnBvc3RncmVzT2JqZWN0VG9QYXJzZU9iamVjdChjbGFzc05hbWUsIGEsIHNjaGVtYSlcbiAgICAgIClcbiAgICAgIC50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgICByZXN1bHRzLmZvckVhY2gocmVzdWx0ID0+IHtcbiAgICAgICAgICBpZiAoIXJlc3VsdC5oYXNPd25Qcm9wZXJ0eSgnb2JqZWN0SWQnKSkge1xuICAgICAgICAgICAgcmVzdWx0Lm9iamVjdElkID0gbnVsbDtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGdyb3VwVmFsdWVzKSB7XG4gICAgICAgICAgICByZXN1bHQub2JqZWN0SWQgPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3Qga2V5IGluIGdyb3VwVmFsdWVzKSB7XG4gICAgICAgICAgICAgIHJlc3VsdC5vYmplY3RJZFtrZXldID0gcmVzdWx0W2tleV07XG4gICAgICAgICAgICAgIGRlbGV0ZSByZXN1bHRba2V5XTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGNvdW50RmllbGQpIHtcbiAgICAgICAgICAgIHJlc3VsdFtjb3VudEZpZWxkXSA9IHBhcnNlSW50KHJlc3VsdFtjb3VudEZpZWxkXSwgMTApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiByZXN1bHRzO1xuICAgICAgfSk7XG4gIH1cblxuICBwZXJmb3JtSW5pdGlhbGl6YXRpb24oeyBWb2xhdGlsZUNsYXNzZXNTY2hlbWFzIH06IGFueSkge1xuICAgIC8vIFRPRE86IFRoaXMgbWV0aG9kIG5lZWRzIHRvIGJlIHJld3JpdHRlbiB0byBtYWtlIHByb3BlciB1c2Ugb2YgY29ubmVjdGlvbnMgKEB2aXRhbHktdClcbiAgICBkZWJ1ZygncGVyZm9ybUluaXRpYWxpemF0aW9uJyk7XG4gICAgY29uc3QgcHJvbWlzZXMgPSBWb2xhdGlsZUNsYXNzZXNTY2hlbWFzLm1hcChzY2hlbWEgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGFibGUoc2NoZW1hLmNsYXNzTmFtZSwgc2NoZW1hKVxuICAgICAgICAuY2F0Y2goZXJyID0+IHtcbiAgICAgICAgICBpZiAoXG4gICAgICAgICAgICBlcnIuY29kZSA9PT0gUG9zdGdyZXNEdXBsaWNhdGVSZWxhdGlvbkVycm9yIHx8XG4gICAgICAgICAgICBlcnIuY29kZSA9PT0gUGFyc2UuRXJyb3IuSU5WQUxJRF9DTEFTU19OQU1FXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgfSlcbiAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5zY2hlbWFVcGdyYWRlKHNjaGVtYS5jbGFzc05hbWUsIHNjaGVtYSkpO1xuICAgIH0pO1xuICAgIHJldHVybiBQcm9taXNlLmFsbChwcm9taXNlcylcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2NsaWVudC50eCgncGVyZm9ybS1pbml0aWFsaXphdGlvbicsIHQgPT4ge1xuICAgICAgICAgIHJldHVybiB0LmJhdGNoKFtcbiAgICAgICAgICAgIHQubm9uZShzcWwubWlzYy5qc29uT2JqZWN0U2V0S2V5cyksXG4gICAgICAgICAgICB0Lm5vbmUoc3FsLmFycmF5LmFkZCksXG4gICAgICAgICAgICB0Lm5vbmUoc3FsLmFycmF5LmFkZFVuaXF1ZSksXG4gICAgICAgICAgICB0Lm5vbmUoc3FsLmFycmF5LnJlbW92ZSksXG4gICAgICAgICAgICB0Lm5vbmUoc3FsLmFycmF5LmNvbnRhaW5zQWxsKSxcbiAgICAgICAgICAgIHQubm9uZShzcWwuYXJyYXkuY29udGFpbnNBbGxSZWdleCksXG4gICAgICAgICAgICB0Lm5vbmUoc3FsLmFycmF5LmNvbnRhaW5zKSxcbiAgICAgICAgICBdKTtcbiAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICAgLnRoZW4oZGF0YSA9PiB7XG4gICAgICAgIGRlYnVnKGBpbml0aWFsaXphdGlvbkRvbmUgaW4gJHtkYXRhLmR1cmF0aW9ufWApO1xuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIC8qIGVzbGludC1kaXNhYmxlIG5vLWNvbnNvbGUgKi9cbiAgICAgICAgY29uc29sZS5lcnJvcihlcnJvcik7XG4gICAgICB9KTtcbiAgfVxuXG4gIGNyZWF0ZUluZGV4ZXMoY2xhc3NOYW1lOiBzdHJpbmcsIGluZGV4ZXM6IGFueSwgY29ubjogP2FueSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiAoY29ubiB8fCB0aGlzLl9jbGllbnQpLnR4KHQgPT5cbiAgICAgIHQuYmF0Y2goXG4gICAgICAgIGluZGV4ZXMubWFwKGkgPT4ge1xuICAgICAgICAgIHJldHVybiB0Lm5vbmUoJ0NSRUFURSBJTkRFWCAkMTpuYW1lIE9OICQyOm5hbWUgKCQzOm5hbWUpJywgW1xuICAgICAgICAgICAgaS5uYW1lLFxuICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgaS5rZXksXG4gICAgICAgICAgXSk7XG4gICAgICAgIH0pXG4gICAgICApXG4gICAgKTtcbiAgfVxuXG4gIGNyZWF0ZUluZGV4ZXNJZk5lZWRlZChcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBmaWVsZE5hbWU6IHN0cmluZyxcbiAgICB0eXBlOiBhbnksXG4gICAgY29ubjogP2FueVxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gKGNvbm4gfHwgdGhpcy5fY2xpZW50KS5ub25lKFxuICAgICAgJ0NSRUFURSBJTkRFWCAkMTpuYW1lIE9OICQyOm5hbWUgKCQzOm5hbWUpJyxcbiAgICAgIFtmaWVsZE5hbWUsIGNsYXNzTmFtZSwgdHlwZV1cbiAgICApO1xuICB9XG5cbiAgZHJvcEluZGV4ZXMoY2xhc3NOYW1lOiBzdHJpbmcsIGluZGV4ZXM6IGFueSwgY29ubjogYW55KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcXVlcmllcyA9IGluZGV4ZXMubWFwKGkgPT4gKHtcbiAgICAgIHF1ZXJ5OiAnRFJPUCBJTkRFWCAkMTpuYW1lJyxcbiAgICAgIHZhbHVlczogaSxcbiAgICB9KSk7XG4gICAgcmV0dXJuIChjb25uIHx8IHRoaXMuX2NsaWVudCkudHgodCA9PlxuICAgICAgdC5ub25lKHRoaXMuX3BncC5oZWxwZXJzLmNvbmNhdChxdWVyaWVzKSlcbiAgICApO1xuICB9XG5cbiAgZ2V0SW5kZXhlcyhjbGFzc05hbWU6IHN0cmluZykge1xuICAgIGNvbnN0IHFzID0gJ1NFTEVDVCAqIEZST00gcGdfaW5kZXhlcyBXSEVSRSB0YWJsZW5hbWUgPSAke2NsYXNzTmFtZX0nO1xuICAgIHJldHVybiB0aGlzLl9jbGllbnQuYW55KHFzLCB7IGNsYXNzTmFtZSB9KTtcbiAgfVxuXG4gIHVwZGF0ZVNjaGVtYVdpdGhJbmRleGVzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjb252ZXJ0UG9seWdvblRvU1FMKHBvbHlnb24pIHtcbiAgaWYgKHBvbHlnb24ubGVuZ3RoIDwgMykge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgIGBQb2x5Z29uIG11c3QgaGF2ZSBhdCBsZWFzdCAzIHZhbHVlc2BcbiAgICApO1xuICB9XG4gIGlmIChcbiAgICBwb2x5Z29uWzBdWzBdICE9PSBwb2x5Z29uW3BvbHlnb24ubGVuZ3RoIC0gMV1bMF0gfHxcbiAgICBwb2x5Z29uWzBdWzFdICE9PSBwb2x5Z29uW3BvbHlnb24ubGVuZ3RoIC0gMV1bMV1cbiAgKSB7XG4gICAgcG9seWdvbi5wdXNoKHBvbHlnb25bMF0pO1xuICB9XG4gIGNvbnN0IHVuaXF1ZSA9IHBvbHlnb24uZmlsdGVyKChpdGVtLCBpbmRleCwgYXIpID0+IHtcbiAgICBsZXQgZm91bmRJbmRleCA9IC0xO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYXIubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgIGNvbnN0IHB0ID0gYXJbaV07XG4gICAgICBpZiAocHRbMF0gPT09IGl0ZW1bMF0gJiYgcHRbMV0gPT09IGl0ZW1bMV0pIHtcbiAgICAgICAgZm91bmRJbmRleCA9IGk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gZm91bmRJbmRleCA9PT0gaW5kZXg7XG4gIH0pO1xuICBpZiAodW5pcXVlLmxlbmd0aCA8IDMpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICBQYXJzZS5FcnJvci5JTlRFUk5BTF9TRVJWRVJfRVJST1IsXG4gICAgICAnR2VvSlNPTjogTG9vcCBtdXN0IGhhdmUgYXQgbGVhc3QgMyBkaWZmZXJlbnQgdmVydGljZXMnXG4gICAgKTtcbiAgfVxuICBjb25zdCBwb2ludHMgPSBwb2x5Z29uXG4gICAgLm1hcChwb2ludCA9PiB7XG4gICAgICBQYXJzZS5HZW9Qb2ludC5fdmFsaWRhdGUocGFyc2VGbG9hdChwb2ludFsxXSksIHBhcnNlRmxvYXQocG9pbnRbMF0pKTtcbiAgICAgIHJldHVybiBgKCR7cG9pbnRbMV19LCAke3BvaW50WzBdfSlgO1xuICAgIH0pXG4gICAgLmpvaW4oJywgJyk7XG4gIHJldHVybiBgKCR7cG9pbnRzfSlgO1xufVxuXG5mdW5jdGlvbiByZW1vdmVXaGl0ZVNwYWNlKHJlZ2V4KSB7XG4gIGlmICghcmVnZXguZW5kc1dpdGgoJ1xcbicpKSB7XG4gICAgcmVnZXggKz0gJ1xcbic7XG4gIH1cblxuICAvLyByZW1vdmUgbm9uIGVzY2FwZWQgY29tbWVudHNcbiAgcmV0dXJuIChcbiAgICByZWdleFxuICAgICAgLnJlcGxhY2UoLyhbXlxcXFxdKSMuKlxcbi9naW0sICckMScpXG4gICAgICAvLyByZW1vdmUgbGluZXMgc3RhcnRpbmcgd2l0aCBhIGNvbW1lbnRcbiAgICAgIC5yZXBsYWNlKC9eIy4qXFxuL2dpbSwgJycpXG4gICAgICAvLyByZW1vdmUgbm9uIGVzY2FwZWQgd2hpdGVzcGFjZVxuICAgICAgLnJlcGxhY2UoLyhbXlxcXFxdKVxccysvZ2ltLCAnJDEnKVxuICAgICAgLy8gcmVtb3ZlIHdoaXRlc3BhY2UgYXQgdGhlIGJlZ2lubmluZyBvZiBhIGxpbmVcbiAgICAgIC5yZXBsYWNlKC9eXFxzKy8sICcnKVxuICAgICAgLnRyaW0oKVxuICApO1xufVxuXG5mdW5jdGlvbiBwcm9jZXNzUmVnZXhQYXR0ZXJuKHMpIHtcbiAgaWYgKHMgJiYgcy5zdGFydHNXaXRoKCdeJykpIHtcbiAgICAvLyByZWdleCBmb3Igc3RhcnRzV2l0aFxuICAgIHJldHVybiAnXicgKyBsaXRlcmFsaXplUmVnZXhQYXJ0KHMuc2xpY2UoMSkpO1xuICB9IGVsc2UgaWYgKHMgJiYgcy5lbmRzV2l0aCgnJCcpKSB7XG4gICAgLy8gcmVnZXggZm9yIGVuZHNXaXRoXG4gICAgcmV0dXJuIGxpdGVyYWxpemVSZWdleFBhcnQocy5zbGljZSgwLCBzLmxlbmd0aCAtIDEpKSArICckJztcbiAgfVxuXG4gIC8vIHJlZ2V4IGZvciBjb250YWluc1xuICByZXR1cm4gbGl0ZXJhbGl6ZVJlZ2V4UGFydChzKTtcbn1cblxuZnVuY3Rpb24gaXNTdGFydHNXaXRoUmVnZXgodmFsdWUpIHtcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09ICdzdHJpbmcnIHx8ICF2YWx1ZS5zdGFydHNXaXRoKCdeJykpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBjb25zdCBtYXRjaGVzID0gdmFsdWUubWF0Y2goL1xcXlxcXFxRLipcXFxcRS8pO1xuICByZXR1cm4gISFtYXRjaGVzO1xufVxuXG5mdW5jdGlvbiBpc0FsbFZhbHVlc1JlZ2V4T3JOb25lKHZhbHVlcykge1xuICBpZiAoIXZhbHVlcyB8fCAhQXJyYXkuaXNBcnJheSh2YWx1ZXMpIHx8IHZhbHVlcy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIGNvbnN0IGZpcnN0VmFsdWVzSXNSZWdleCA9IGlzU3RhcnRzV2l0aFJlZ2V4KHZhbHVlc1swXS4kcmVnZXgpO1xuICBpZiAodmFsdWVzLmxlbmd0aCA9PT0gMSkge1xuICAgIHJldHVybiBmaXJzdFZhbHVlc0lzUmVnZXg7XG4gIH1cblxuICBmb3IgKGxldCBpID0gMSwgbGVuZ3RoID0gdmFsdWVzLmxlbmd0aDsgaSA8IGxlbmd0aDsgKytpKSB7XG4gICAgaWYgKGZpcnN0VmFsdWVzSXNSZWdleCAhPT0gaXNTdGFydHNXaXRoUmVnZXgodmFsdWVzW2ldLiRyZWdleCkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gaXNBbnlWYWx1ZVJlZ2V4U3RhcnRzV2l0aCh2YWx1ZXMpIHtcbiAgcmV0dXJuIHZhbHVlcy5zb21lKGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgcmV0dXJuIGlzU3RhcnRzV2l0aFJlZ2V4KHZhbHVlLiRyZWdleCk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVMaXRlcmFsUmVnZXgocmVtYWluaW5nKSB7XG4gIHJldHVybiByZW1haW5pbmdcbiAgICAuc3BsaXQoJycpXG4gICAgLm1hcChjID0+IHtcbiAgICAgIGNvbnN0IHJlZ2V4ID0gWFJlZ0V4cCgnWzAtOSBdfFxcXFxwe0x9Jyk7IC8vIFN1cHBvcnQgYWxsIHVuaWNvZGUgbGV0dGVyIGNoYXJzXG4gICAgICBpZiAoYy5tYXRjaChyZWdleCkgIT09IG51bGwpIHtcbiAgICAgICAgLy8gZG9uJ3QgZXNjYXBlIGFscGhhbnVtZXJpYyBjaGFyYWN0ZXJzXG4gICAgICAgIHJldHVybiBjO1xuICAgICAgfVxuICAgICAgLy8gZXNjYXBlIGV2ZXJ5dGhpbmcgZWxzZSAoc2luZ2xlIHF1b3RlcyB3aXRoIHNpbmdsZSBxdW90ZXMsIGV2ZXJ5dGhpbmcgZWxzZSB3aXRoIGEgYmFja3NsYXNoKVxuICAgICAgcmV0dXJuIGMgPT09IGAnYCA/IGAnJ2AgOiBgXFxcXCR7Y31gO1xuICAgIH0pXG4gICAgLmpvaW4oJycpO1xuIH1cblxuZnVuY3Rpb24gbGl0ZXJhbGl6ZVJlZ2V4UGFydChzOiBzdHJpbmcpIHtcbiAgY29uc3QgbWF0Y2hlcjEgPSAvXFxcXFEoKD8hXFxcXEUpLiopXFxcXEUkLztcbiAgY29uc3QgcmVzdWx0MTogYW55ID0gcy5tYXRjaChtYXRjaGVyMSk7XG4gIGlmIChyZXN1bHQxICYmIHJlc3VsdDEubGVuZ3RoID4gMSAmJiByZXN1bHQxLmluZGV4ID4gLTEpIHtcbiAgICAvLyBwcm9jZXNzIHJlZ2V4IHRoYXQgaGFzIGEgYmVnaW5uaW5nIGFuZCBhbiBlbmQgc3BlY2lmaWVkIGZvciB0aGUgbGl0ZXJhbCB0ZXh0XG4gICAgY29uc3QgcHJlZml4ID0gcy5zdWJzdHIoMCwgcmVzdWx0MS5pbmRleCk7XG4gICAgY29uc3QgcmVtYWluaW5nID0gcmVzdWx0MVsxXTtcblxuICAgIHJldHVybiBsaXRlcmFsaXplUmVnZXhQYXJ0KHByZWZpeCkgKyBjcmVhdGVMaXRlcmFsUmVnZXgocmVtYWluaW5nKTtcbiAgfVxuXG4gIC8vIHByb2Nlc3MgcmVnZXggdGhhdCBoYXMgYSBiZWdpbm5pbmcgc3BlY2lmaWVkIGZvciB0aGUgbGl0ZXJhbCB0ZXh0XG4gIGNvbnN0IG1hdGNoZXIyID0gL1xcXFxRKCg/IVxcXFxFKS4qKSQvO1xuICBjb25zdCByZXN1bHQyOiBhbnkgPSBzLm1hdGNoKG1hdGNoZXIyKTtcbiAgaWYgKHJlc3VsdDIgJiYgcmVzdWx0Mi5sZW5ndGggPiAxICYmIHJlc3VsdDIuaW5kZXggPiAtMSkge1xuICAgIGNvbnN0IHByZWZpeCA9IHMuc3Vic3RyKDAsIHJlc3VsdDIuaW5kZXgpO1xuICAgIGNvbnN0IHJlbWFpbmluZyA9IHJlc3VsdDJbMV07XG5cbiAgICByZXR1cm4gbGl0ZXJhbGl6ZVJlZ2V4UGFydChwcmVmaXgpICsgY3JlYXRlTGl0ZXJhbFJlZ2V4KHJlbWFpbmluZyk7XG4gIH1cblxuICAvLyByZW1vdmUgYWxsIGluc3RhbmNlcyBvZiBcXFEgYW5kIFxcRSBmcm9tIHRoZSByZW1haW5pbmcgdGV4dCAmIGVzY2FwZSBzaW5nbGUgcXVvdGVzXG4gIHJldHVybiBzXG4gICAgLnJlcGxhY2UoLyhbXlxcXFxdKShcXFxcRSkvLCAnJDEnKVxuICAgIC5yZXBsYWNlKC8oW15cXFxcXSkoXFxcXFEpLywgJyQxJylcbiAgICAucmVwbGFjZSgvXlxcXFxFLywgJycpXG4gICAgLnJlcGxhY2UoL15cXFxcUS8sICcnKVxuICAgIC5yZXBsYWNlKC8oW14nXSknLywgYCQxJydgKVxuICAgIC5yZXBsYWNlKC9eJyhbXiddKS8sIGAnJyQxYCk7XG59XG5cbnZhciBHZW9Qb2ludENvZGVyID0ge1xuICBpc1ZhbGlkSlNPTih2YWx1ZSkge1xuICAgIHJldHVybiAoXG4gICAgICB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICE9PSBudWxsICYmIHZhbHVlLl9fdHlwZSA9PT0gJ0dlb1BvaW50J1xuICAgICk7XG4gIH0sXG59O1xuXG5leHBvcnQgZGVmYXVsdCBQb3N0Z3Jlc1N0b3JhZ2VBZGFwdGVyO1xuIl19