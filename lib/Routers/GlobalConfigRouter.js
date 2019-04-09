"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.GlobalConfigRouter = void 0;

var _node = _interopRequireDefault(require("parse/node"));

var _PromiseRouter = _interopRequireDefault(require("../PromiseRouter"));

var middleware = _interopRequireWildcard(require("../middlewares"));

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = Object.defineProperty && Object.getOwnPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : {}; if (desc.get || desc.set) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// global_config.js
class GlobalConfigRouter extends _PromiseRouter.default {
  getGlobalConfig(req) {
    return req.config.database.find('_GlobalConfig', {
      objectId: '1'
    }, {
      limit: 1
    }).then(results => {
      if (results.length != 1) {
        // If there is no config in the database - return empty config.
        return {
          response: {
            params: {}
          }
        };
      }

      const globalConfig = results[0];
      return {
        response: {
          params: globalConfig.params
        }
      };
    });
  }

  updateGlobalConfig(req) {
    if (req.auth.isReadOnly) {
      throw new _node.default.Error(_node.default.Error.OPERATION_FORBIDDEN, "read-only masterKey isn't allowed to update the config.");
    }

    const params = req.body.params; // Transform in dot notation to make sure it works

    const update = Object.keys(params).reduce((acc, key) => {
      acc[`params.${key}`] = params[key];
      return acc;
    }, {});
    return req.config.database.update('_GlobalConfig', {
      objectId: '1'
    }, update, {
      upsert: true
    }).then(() => ({
      response: {
        result: true
      }
    }));
  }

  mountRoutes() {
    this.route('GET', '/config', req => {
      return this.getGlobalConfig(req);
    });
    this.route('PUT', '/config', middleware.promiseEnforceMasterKeyAccess, req => {
      return this.updateGlobalConfig(req);
    });
  }

}

exports.GlobalConfigRouter = GlobalConfigRouter;
var _default = GlobalConfigRouter;
exports.default = _default;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL0dsb2JhbENvbmZpZ1JvdXRlci5qcyJdLCJuYW1lcyI6WyJHbG9iYWxDb25maWdSb3V0ZXIiLCJQcm9taXNlUm91dGVyIiwiZ2V0R2xvYmFsQ29uZmlnIiwicmVxIiwiY29uZmlnIiwiZGF0YWJhc2UiLCJmaW5kIiwib2JqZWN0SWQiLCJsaW1pdCIsInRoZW4iLCJyZXN1bHRzIiwibGVuZ3RoIiwicmVzcG9uc2UiLCJwYXJhbXMiLCJnbG9iYWxDb25maWciLCJ1cGRhdGVHbG9iYWxDb25maWciLCJhdXRoIiwiaXNSZWFkT25seSIsIlBhcnNlIiwiRXJyb3IiLCJPUEVSQVRJT05fRk9SQklEREVOIiwiYm9keSIsInVwZGF0ZSIsIk9iamVjdCIsImtleXMiLCJyZWR1Y2UiLCJhY2MiLCJrZXkiLCJ1cHNlcnQiLCJyZXN1bHQiLCJtb3VudFJvdXRlcyIsInJvdXRlIiwibWlkZGxld2FyZSIsInByb21pc2VFbmZvcmNlTWFzdGVyS2V5QWNjZXNzIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQ0E7O0FBQ0E7O0FBQ0E7Ozs7OztBQUhBO0FBS08sTUFBTUEsa0JBQU4sU0FBaUNDLHNCQUFqQyxDQUErQztBQUNwREMsRUFBQUEsZUFBZSxDQUFDQyxHQUFELEVBQU07QUFDbkIsV0FBT0EsR0FBRyxDQUFDQyxNQUFKLENBQVdDLFFBQVgsQ0FDSkMsSUFESSxDQUNDLGVBREQsRUFDa0I7QUFBRUMsTUFBQUEsUUFBUSxFQUFFO0FBQVosS0FEbEIsRUFDcUM7QUFBRUMsTUFBQUEsS0FBSyxFQUFFO0FBQVQsS0FEckMsRUFFSkMsSUFGSSxDQUVDQyxPQUFPLElBQUk7QUFDZixVQUFJQSxPQUFPLENBQUNDLE1BQVIsSUFBa0IsQ0FBdEIsRUFBeUI7QUFDdkI7QUFDQSxlQUFPO0FBQUVDLFVBQUFBLFFBQVEsRUFBRTtBQUFFQyxZQUFBQSxNQUFNLEVBQUU7QUFBVjtBQUFaLFNBQVA7QUFDRDs7QUFDRCxZQUFNQyxZQUFZLEdBQUdKLE9BQU8sQ0FBQyxDQUFELENBQTVCO0FBQ0EsYUFBTztBQUFFRSxRQUFBQSxRQUFRLEVBQUU7QUFBRUMsVUFBQUEsTUFBTSxFQUFFQyxZQUFZLENBQUNEO0FBQXZCO0FBQVosT0FBUDtBQUNELEtBVEksQ0FBUDtBQVVEOztBQUVERSxFQUFBQSxrQkFBa0IsQ0FBQ1osR0FBRCxFQUFNO0FBQ3RCLFFBQUlBLEdBQUcsQ0FBQ2EsSUFBSixDQUFTQyxVQUFiLEVBQXlCO0FBQ3ZCLFlBQU0sSUFBSUMsY0FBTUMsS0FBVixDQUNKRCxjQUFNQyxLQUFOLENBQVlDLG1CQURSLEVBRUoseURBRkksQ0FBTjtBQUlEOztBQUNELFVBQU1QLE1BQU0sR0FBR1YsR0FBRyxDQUFDa0IsSUFBSixDQUFTUixNQUF4QixDQVBzQixDQVF0Qjs7QUFDQSxVQUFNUyxNQUFNLEdBQUdDLE1BQU0sQ0FBQ0MsSUFBUCxDQUFZWCxNQUFaLEVBQW9CWSxNQUFwQixDQUEyQixDQUFDQyxHQUFELEVBQU1DLEdBQU4sS0FBYztBQUN0REQsTUFBQUEsR0FBRyxDQUFFLFVBQVNDLEdBQUksRUFBZixDQUFILEdBQXVCZCxNQUFNLENBQUNjLEdBQUQsQ0FBN0I7QUFDQSxhQUFPRCxHQUFQO0FBQ0QsS0FIYyxFQUdaLEVBSFksQ0FBZjtBQUlBLFdBQU92QixHQUFHLENBQUNDLE1BQUosQ0FBV0MsUUFBWCxDQUNKaUIsTUFESSxDQUNHLGVBREgsRUFDb0I7QUFBRWYsTUFBQUEsUUFBUSxFQUFFO0FBQVosS0FEcEIsRUFDdUNlLE1BRHZDLEVBQytDO0FBQUVNLE1BQUFBLE1BQU0sRUFBRTtBQUFWLEtBRC9DLEVBRUpuQixJQUZJLENBRUMsT0FBTztBQUFFRyxNQUFBQSxRQUFRLEVBQUU7QUFBRWlCLFFBQUFBLE1BQU0sRUFBRTtBQUFWO0FBQVosS0FBUCxDQUZELENBQVA7QUFHRDs7QUFFREMsRUFBQUEsV0FBVyxHQUFHO0FBQ1osU0FBS0MsS0FBTCxDQUFXLEtBQVgsRUFBa0IsU0FBbEIsRUFBNkI1QixHQUFHLElBQUk7QUFDbEMsYUFBTyxLQUFLRCxlQUFMLENBQXFCQyxHQUFyQixDQUFQO0FBQ0QsS0FGRDtBQUdBLFNBQUs0QixLQUFMLENBQ0UsS0FERixFQUVFLFNBRkYsRUFHRUMsVUFBVSxDQUFDQyw2QkFIYixFQUlFOUIsR0FBRyxJQUFJO0FBQ0wsYUFBTyxLQUFLWSxrQkFBTCxDQUF3QlosR0FBeEIsQ0FBUDtBQUNELEtBTkg7QUFRRDs7QUE1Q21EOzs7ZUErQ3ZDSCxrQiIsInNvdXJjZXNDb250ZW50IjpbIi8vIGdsb2JhbF9jb25maWcuanNcbmltcG9ydCBQYXJzZSBmcm9tICdwYXJzZS9ub2RlJztcbmltcG9ydCBQcm9taXNlUm91dGVyIGZyb20gJy4uL1Byb21pc2VSb3V0ZXInO1xuaW1wb3J0ICogYXMgbWlkZGxld2FyZSBmcm9tICcuLi9taWRkbGV3YXJlcyc7XG5cbmV4cG9ydCBjbGFzcyBHbG9iYWxDb25maWdSb3V0ZXIgZXh0ZW5kcyBQcm9taXNlUm91dGVyIHtcbiAgZ2V0R2xvYmFsQ29uZmlnKHJlcSkge1xuICAgIHJldHVybiByZXEuY29uZmlnLmRhdGFiYXNlXG4gICAgICAuZmluZCgnX0dsb2JhbENvbmZpZycsIHsgb2JqZWN0SWQ6ICcxJyB9LCB7IGxpbWl0OiAxIH0pXG4gICAgICAudGhlbihyZXN1bHRzID0+IHtcbiAgICAgICAgaWYgKHJlc3VsdHMubGVuZ3RoICE9IDEpIHtcbiAgICAgICAgICAvLyBJZiB0aGVyZSBpcyBubyBjb25maWcgaW4gdGhlIGRhdGFiYXNlIC0gcmV0dXJuIGVtcHR5IGNvbmZpZy5cbiAgICAgICAgICByZXR1cm4geyByZXNwb25zZTogeyBwYXJhbXM6IHt9IH0gfTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBnbG9iYWxDb25maWcgPSByZXN1bHRzWzBdO1xuICAgICAgICByZXR1cm4geyByZXNwb25zZTogeyBwYXJhbXM6IGdsb2JhbENvbmZpZy5wYXJhbXMgfSB9O1xuICAgICAgfSk7XG4gIH1cblxuICB1cGRhdGVHbG9iYWxDb25maWcocmVxKSB7XG4gICAgaWYgKHJlcS5hdXRoLmlzUmVhZE9ubHkpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgICAgXCJyZWFkLW9ubHkgbWFzdGVyS2V5IGlzbid0IGFsbG93ZWQgdG8gdXBkYXRlIHRoZSBjb25maWcuXCJcbiAgICAgICk7XG4gICAgfVxuICAgIGNvbnN0IHBhcmFtcyA9IHJlcS5ib2R5LnBhcmFtcztcbiAgICAvLyBUcmFuc2Zvcm0gaW4gZG90IG5vdGF0aW9uIHRvIG1ha2Ugc3VyZSBpdCB3b3Jrc1xuICAgIGNvbnN0IHVwZGF0ZSA9IE9iamVjdC5rZXlzKHBhcmFtcykucmVkdWNlKChhY2MsIGtleSkgPT4ge1xuICAgICAgYWNjW2BwYXJhbXMuJHtrZXl9YF0gPSBwYXJhbXNba2V5XTtcbiAgICAgIHJldHVybiBhY2M7XG4gICAgfSwge30pO1xuICAgIHJldHVybiByZXEuY29uZmlnLmRhdGFiYXNlXG4gICAgICAudXBkYXRlKCdfR2xvYmFsQ29uZmlnJywgeyBvYmplY3RJZDogJzEnIH0sIHVwZGF0ZSwgeyB1cHNlcnQ6IHRydWUgfSlcbiAgICAgIC50aGVuKCgpID0+ICh7IHJlc3BvbnNlOiB7IHJlc3VsdDogdHJ1ZSB9IH0pKTtcbiAgfVxuXG4gIG1vdW50Um91dGVzKCkge1xuICAgIHRoaXMucm91dGUoJ0dFVCcsICcvY29uZmlnJywgcmVxID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmdldEdsb2JhbENvbmZpZyhyZXEpO1xuICAgIH0pO1xuICAgIHRoaXMucm91dGUoXG4gICAgICAnUFVUJyxcbiAgICAgICcvY29uZmlnJyxcbiAgICAgIG1pZGRsZXdhcmUucHJvbWlzZUVuZm9yY2VNYXN0ZXJLZXlBY2Nlc3MsXG4gICAgICByZXEgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy51cGRhdGVHbG9iYWxDb25maWcocmVxKTtcbiAgICAgIH1cbiAgICApO1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IEdsb2JhbENvbmZpZ1JvdXRlcjtcbiJdfQ==