"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.PurgeRouter = void 0;

var _PromiseRouter = _interopRequireDefault(require("../PromiseRouter"));

var middleware = _interopRequireWildcard(require("../middlewares"));

var _node = _interopRequireDefault(require("parse/node"));

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = Object.defineProperty && Object.getOwnPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : {}; if (desc.get || desc.set) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class PurgeRouter extends _PromiseRouter.default {
  handlePurge(req) {
    if (req.auth.isReadOnly) {
      throw new _node.default.Error(_node.default.Error.OPERATION_FORBIDDEN, "read-only masterKey isn't allowed to purge a schema.");
    }

    return req.config.database.purgeCollection(req.params.className).then(() => {
      var cacheAdapter = req.config.cacheController;

      if (req.params.className == '_Session') {
        cacheAdapter.user.clear();
      } else if (req.params.className == '_Role') {
        cacheAdapter.role.clear();
      }

      return {
        response: {}
      };
    }).catch(error => {
      if (!error || error && error.code === _node.default.Error.OBJECT_NOT_FOUND) {
        return {
          response: {}
        };
      }

      throw error;
    });
  }

  mountRoutes() {
    this.route('DELETE', '/purge/:className', middleware.promiseEnforceMasterKeyAccess, req => {
      return this.handlePurge(req);
    });
  }

}

exports.PurgeRouter = PurgeRouter;
var _default = PurgeRouter;
exports.default = _default;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL1B1cmdlUm91dGVyLmpzIl0sIm5hbWVzIjpbIlB1cmdlUm91dGVyIiwiUHJvbWlzZVJvdXRlciIsImhhbmRsZVB1cmdlIiwicmVxIiwiYXV0aCIsImlzUmVhZE9ubHkiLCJQYXJzZSIsIkVycm9yIiwiT1BFUkFUSU9OX0ZPUkJJRERFTiIsImNvbmZpZyIsImRhdGFiYXNlIiwicHVyZ2VDb2xsZWN0aW9uIiwicGFyYW1zIiwiY2xhc3NOYW1lIiwidGhlbiIsImNhY2hlQWRhcHRlciIsImNhY2hlQ29udHJvbGxlciIsInVzZXIiLCJjbGVhciIsInJvbGUiLCJyZXNwb25zZSIsImNhdGNoIiwiZXJyb3IiLCJjb2RlIiwiT0JKRUNUX05PVF9GT1VORCIsIm1vdW50Um91dGVzIiwicm91dGUiLCJtaWRkbGV3YXJlIiwicHJvbWlzZUVuZm9yY2VNYXN0ZXJLZXlBY2Nlc3MiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBQTs7QUFDQTs7QUFDQTs7Ozs7O0FBRU8sTUFBTUEsV0FBTixTQUEwQkMsc0JBQTFCLENBQXdDO0FBQzdDQyxFQUFBQSxXQUFXLENBQUNDLEdBQUQsRUFBTTtBQUNmLFFBQUlBLEdBQUcsQ0FBQ0MsSUFBSixDQUFTQyxVQUFiLEVBQXlCO0FBQ3ZCLFlBQU0sSUFBSUMsY0FBTUMsS0FBVixDQUNKRCxjQUFNQyxLQUFOLENBQVlDLG1CQURSLEVBRUosc0RBRkksQ0FBTjtBQUlEOztBQUNELFdBQU9MLEdBQUcsQ0FBQ00sTUFBSixDQUFXQyxRQUFYLENBQ0pDLGVBREksQ0FDWVIsR0FBRyxDQUFDUyxNQUFKLENBQVdDLFNBRHZCLEVBRUpDLElBRkksQ0FFQyxNQUFNO0FBQ1YsVUFBSUMsWUFBWSxHQUFHWixHQUFHLENBQUNNLE1BQUosQ0FBV08sZUFBOUI7O0FBQ0EsVUFBSWIsR0FBRyxDQUFDUyxNQUFKLENBQVdDLFNBQVgsSUFBd0IsVUFBNUIsRUFBd0M7QUFDdENFLFFBQUFBLFlBQVksQ0FBQ0UsSUFBYixDQUFrQkMsS0FBbEI7QUFDRCxPQUZELE1BRU8sSUFBSWYsR0FBRyxDQUFDUyxNQUFKLENBQVdDLFNBQVgsSUFBd0IsT0FBNUIsRUFBcUM7QUFDMUNFLFFBQUFBLFlBQVksQ0FBQ0ksSUFBYixDQUFrQkQsS0FBbEI7QUFDRDs7QUFDRCxhQUFPO0FBQUVFLFFBQUFBLFFBQVEsRUFBRTtBQUFaLE9BQVA7QUFDRCxLQVZJLEVBV0pDLEtBWEksQ0FXRUMsS0FBSyxJQUFJO0FBQ2QsVUFBSSxDQUFDQSxLQUFELElBQVdBLEtBQUssSUFBSUEsS0FBSyxDQUFDQyxJQUFOLEtBQWVqQixjQUFNQyxLQUFOLENBQVlpQixnQkFBbkQsRUFBc0U7QUFDcEUsZUFBTztBQUFFSixVQUFBQSxRQUFRLEVBQUU7QUFBWixTQUFQO0FBQ0Q7O0FBQ0QsWUFBTUUsS0FBTjtBQUNELEtBaEJJLENBQVA7QUFpQkQ7O0FBRURHLEVBQUFBLFdBQVcsR0FBRztBQUNaLFNBQUtDLEtBQUwsQ0FDRSxRQURGLEVBRUUsbUJBRkYsRUFHRUMsVUFBVSxDQUFDQyw2QkFIYixFQUlFekIsR0FBRyxJQUFJO0FBQ0wsYUFBTyxLQUFLRCxXQUFMLENBQWlCQyxHQUFqQixDQUFQO0FBQ0QsS0FOSDtBQVFEOztBQXBDNEM7OztlQXVDaENILFciLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgUHJvbWlzZVJvdXRlciBmcm9tICcuLi9Qcm9taXNlUm91dGVyJztcbmltcG9ydCAqIGFzIG1pZGRsZXdhcmUgZnJvbSAnLi4vbWlkZGxld2FyZXMnO1xuaW1wb3J0IFBhcnNlIGZyb20gJ3BhcnNlL25vZGUnO1xuXG5leHBvcnQgY2xhc3MgUHVyZ2VSb3V0ZXIgZXh0ZW5kcyBQcm9taXNlUm91dGVyIHtcbiAgaGFuZGxlUHVyZ2UocmVxKSB7XG4gICAgaWYgKHJlcS5hdXRoLmlzUmVhZE9ubHkpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgICAgXCJyZWFkLW9ubHkgbWFzdGVyS2V5IGlzbid0IGFsbG93ZWQgdG8gcHVyZ2UgYSBzY2hlbWEuXCJcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiByZXEuY29uZmlnLmRhdGFiYXNlXG4gICAgICAucHVyZ2VDb2xsZWN0aW9uKHJlcS5wYXJhbXMuY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICB2YXIgY2FjaGVBZGFwdGVyID0gcmVxLmNvbmZpZy5jYWNoZUNvbnRyb2xsZXI7XG4gICAgICAgIGlmIChyZXEucGFyYW1zLmNsYXNzTmFtZSA9PSAnX1Nlc3Npb24nKSB7XG4gICAgICAgICAgY2FjaGVBZGFwdGVyLnVzZXIuY2xlYXIoKTtcbiAgICAgICAgfSBlbHNlIGlmIChyZXEucGFyYW1zLmNsYXNzTmFtZSA9PSAnX1JvbGUnKSB7XG4gICAgICAgICAgY2FjaGVBZGFwdGVyLnJvbGUuY2xlYXIoKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4geyByZXNwb25zZToge30gfTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoIWVycm9yIHx8IChlcnJvciAmJiBlcnJvci5jb2RlID09PSBQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5EKSkge1xuICAgICAgICAgIHJldHVybiB7IHJlc3BvbnNlOiB7fSB9O1xuICAgICAgICB9XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSk7XG4gIH1cblxuICBtb3VudFJvdXRlcygpIHtcbiAgICB0aGlzLnJvdXRlKFxuICAgICAgJ0RFTEVURScsXG4gICAgICAnL3B1cmdlLzpjbGFzc05hbWUnLFxuICAgICAgbWlkZGxld2FyZS5wcm9taXNlRW5mb3JjZU1hc3RlcktleUFjY2VzcyxcbiAgICAgIHJlcSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLmhhbmRsZVB1cmdlKHJlcSk7XG4gICAgICB9XG4gICAgKTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBQdXJnZVJvdXRlcjtcbiJdfQ==