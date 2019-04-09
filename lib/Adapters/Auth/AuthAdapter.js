"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.AuthAdapter = void 0;

/*eslint no-unused-vars: "off"*/
class AuthAdapter {
  /*
  @param appIds: the specified app ids in the configuration
  @param authData: the client provided authData
  @returns a promise that resolves if the applicationId is valid
   */
  validateAppId(appIds, authData) {
    return Promise.resolve({});
  }
  /*
  @param authData: the client provided authData
  @param options: additional options
   */


  validateAuthData(authData, options) {
    return Promise.resolve({});
  }

}

exports.AuthAdapter = AuthAdapter;
var _default = AuthAdapter;
exports.default = _default;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9BZGFwdGVycy9BdXRoL0F1dGhBZGFwdGVyLmpzIl0sIm5hbWVzIjpbIkF1dGhBZGFwdGVyIiwidmFsaWRhdGVBcHBJZCIsImFwcElkcyIsImF1dGhEYXRhIiwiUHJvbWlzZSIsInJlc29sdmUiLCJ2YWxpZGF0ZUF1dGhEYXRhIiwib3B0aW9ucyJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBO0FBQ08sTUFBTUEsV0FBTixDQUFrQjtBQUN2Qjs7Ozs7QUFLQUMsRUFBQUEsYUFBYSxDQUFDQyxNQUFELEVBQVNDLFFBQVQsRUFBbUI7QUFDOUIsV0FBT0MsT0FBTyxDQUFDQyxPQUFSLENBQWdCLEVBQWhCLENBQVA7QUFDRDtBQUVEOzs7Ozs7QUFJQUMsRUFBQUEsZ0JBQWdCLENBQUNILFFBQUQsRUFBV0ksT0FBWCxFQUFvQjtBQUNsQyxXQUFPSCxPQUFPLENBQUNDLE9BQVIsQ0FBZ0IsRUFBaEIsQ0FBUDtBQUNEOztBQWhCc0I7OztlQW1CVkwsVyIsInNvdXJjZXNDb250ZW50IjpbIi8qZXNsaW50IG5vLXVudXNlZC12YXJzOiBcIm9mZlwiKi9cbmV4cG9ydCBjbGFzcyBBdXRoQWRhcHRlciB7XG4gIC8qXG4gIEBwYXJhbSBhcHBJZHM6IHRoZSBzcGVjaWZpZWQgYXBwIGlkcyBpbiB0aGUgY29uZmlndXJhdGlvblxuICBAcGFyYW0gYXV0aERhdGE6IHRoZSBjbGllbnQgcHJvdmlkZWQgYXV0aERhdGFcbiAgQHJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgaWYgdGhlIGFwcGxpY2F0aW9uSWQgaXMgdmFsaWRcbiAgICovXG4gIHZhbGlkYXRlQXBwSWQoYXBwSWRzLCBhdXRoRGF0YSkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe30pO1xuICB9XG5cbiAgLypcbiAgQHBhcmFtIGF1dGhEYXRhOiB0aGUgY2xpZW50IHByb3ZpZGVkIGF1dGhEYXRhXG4gIEBwYXJhbSBvcHRpb25zOiBhZGRpdGlvbmFsIG9wdGlvbnNcbiAgICovXG4gIHZhbGlkYXRlQXV0aERhdGEoYXV0aERhdGEsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHt9KTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBBdXRoQWRhcHRlcjtcbiJdfQ==