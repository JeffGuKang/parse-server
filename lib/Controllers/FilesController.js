"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.FilesController = void 0;

var _cryptoUtils = require("../cryptoUtils");

var _AdaptableController = _interopRequireDefault(require("./AdaptableController"));

var _FilesAdapter = require("../Adapters/Files/FilesAdapter");

var _path = _interopRequireDefault(require("path"));

var _mime = _interopRequireDefault(require("mime"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// FilesController.js
const legacyFilesRegex = new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-.*');

class FilesController extends _AdaptableController.default {
  getFileData(config, filename) {
    return this.adapter.getFileData(filename);
  }

  createFile(config, filename, data, contentType) {
    const extname = _path.default.extname(filename);

    const hasExtension = extname.length > 0;

    if (!hasExtension && contentType && _mime.default.getExtension(contentType)) {
      filename = filename + '.' + _mime.default.getExtension(contentType);
    } else if (hasExtension && !contentType) {
      contentType = _mime.default.getType(filename);
    }

    if (!this.options.preserveFileName) {
      filename = (0, _cryptoUtils.randomHexString)(32) + '_' + filename;
    }

    const location = this.adapter.getFileLocation(config, filename);
    return this.adapter.createFile(filename, data, contentType).then(() => {
      return Promise.resolve({
        url: location,
        name: filename
      });
    });
  }

  deleteFile(config, filename) {
    return this.adapter.deleteFile(filename);
  }
  /**
   * Find file references in REST-format object and adds the url key
   * with the current mount point and app id.
   * Object may be a single object or list of REST-format objects.
   */


  expandFilesInObject(config, object) {
    if (object instanceof Array) {
      object.map(obj => this.expandFilesInObject(config, obj));
      return;
    }

    if (typeof object !== 'object') {
      return;
    }

    for (const key in object) {
      const fileObject = object[key];

      if (fileObject && fileObject['__type'] === 'File') {
        if (fileObject['url']) {
          continue;
        }

        const filename = fileObject['name']; // all filenames starting with "tfss-" should be from files.parsetfss.com
        // all filenames starting with a "-" seperated UUID should be from files.parse.com
        // all other filenames have been migrated or created from Parse Server

        if (config.fileKey === undefined) {
          fileObject['url'] = this.adapter.getFileLocation(config, filename);
        } else {
          if (filename.indexOf('tfss-') === 0) {
            fileObject['url'] = 'http://files.parsetfss.com/' + config.fileKey + '/' + encodeURIComponent(filename);
          } else if (legacyFilesRegex.test(filename)) {
            fileObject['url'] = 'http://files.parse.com/' + config.fileKey + '/' + encodeURIComponent(filename);
          } else {
            fileObject['url'] = this.adapter.getFileLocation(config, filename);
          }
        }
      }
    }
  }

  expectedAdapterType() {
    return _FilesAdapter.FilesAdapter;
  }

  getFileStream(config, filename) {
    return this.adapter.getFileStream(filename);
  }

}

exports.FilesController = FilesController;
var _default = FilesController;
exports.default = _default;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9GaWxlc0NvbnRyb2xsZXIuanMiXSwibmFtZXMiOlsibGVnYWN5RmlsZXNSZWdleCIsIlJlZ0V4cCIsIkZpbGVzQ29udHJvbGxlciIsIkFkYXB0YWJsZUNvbnRyb2xsZXIiLCJnZXRGaWxlRGF0YSIsImNvbmZpZyIsImZpbGVuYW1lIiwiYWRhcHRlciIsImNyZWF0ZUZpbGUiLCJkYXRhIiwiY29udGVudFR5cGUiLCJleHRuYW1lIiwicGF0aCIsImhhc0V4dGVuc2lvbiIsImxlbmd0aCIsIm1pbWUiLCJnZXRFeHRlbnNpb24iLCJnZXRUeXBlIiwib3B0aW9ucyIsInByZXNlcnZlRmlsZU5hbWUiLCJsb2NhdGlvbiIsImdldEZpbGVMb2NhdGlvbiIsInRoZW4iLCJQcm9taXNlIiwicmVzb2x2ZSIsInVybCIsIm5hbWUiLCJkZWxldGVGaWxlIiwiZXhwYW5kRmlsZXNJbk9iamVjdCIsIm9iamVjdCIsIkFycmF5IiwibWFwIiwib2JqIiwia2V5IiwiZmlsZU9iamVjdCIsImZpbGVLZXkiLCJ1bmRlZmluZWQiLCJpbmRleE9mIiwiZW5jb2RlVVJJQ29tcG9uZW50IiwidGVzdCIsImV4cGVjdGVkQWRhcHRlclR5cGUiLCJGaWxlc0FkYXB0ZXIiLCJnZXRGaWxlU3RyZWFtIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7Ozs7QUFMQTtBQU9BLE1BQU1BLGdCQUFnQixHQUFHLElBQUlDLE1BQUosQ0FDdkIsaUZBRHVCLENBQXpCOztBQUlPLE1BQU1DLGVBQU4sU0FBOEJDLDRCQUE5QixDQUFrRDtBQUN2REMsRUFBQUEsV0FBVyxDQUFDQyxNQUFELEVBQVNDLFFBQVQsRUFBbUI7QUFDNUIsV0FBTyxLQUFLQyxPQUFMLENBQWFILFdBQWIsQ0FBeUJFLFFBQXpCLENBQVA7QUFDRDs7QUFFREUsRUFBQUEsVUFBVSxDQUFDSCxNQUFELEVBQVNDLFFBQVQsRUFBbUJHLElBQW5CLEVBQXlCQyxX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VUFBVSxDQUFDLEtBQUQsQ0FBVixHQUNFLDRCQUNBN0IsTUFBTSxDQUFDOEIsT0FEUCxHQUVBLEdBRkEsR0FHQUcsa0JBQWtCLENBQUNoQyxRQUFELENBSnBCO0FBS0QsV0FOTSxNQU1BO0FBQ0w0QixZQUFBQSxVQUFVLENBQUMsS0FBRCxDQUFWLEdBQW9CLEtBQUszQixPQUFMLENBQWFjLGVBQWIsQ0FBNkJoQixNQUE3QixFQUFxQ0MsUUFBckMsQ0FBcEI7QUFDRDtBQUNGO0FBQ0Y7QUFDRjtBQUNGOztBQUVEa0MsRUFBQUEsbUJBQW1CLEdBQUc7QUFDcEIsV0FBT0MsMEJBQVA7QUFDRDs7QUFFREMsRUFBQUEsYUFBYSxDQUFDckMsTUFBRCxFQUFTQyxRQUFULEVBQW1CO0FBQzlCLFdBQU8sS0FBS0MsT0FBTCxDQUFhbUMsYUFBYixDQUEyQnBDLFFBQTNCLENBQVA7QUFDRDs7QUFyRnNEOzs7ZUF3RjFDSixlIiwic291cmNlc0NvbnRlbnQiOlsiLy8gRmlsZXNDb250cm9sbGVyLmpzXG5pbXBvcnQgeyByYW5kb21IZXhTdHJpbmcgfSBmcm9tICcuLi9jcnlwdG9VdGlscyc7XG5pbXBvcnQgQWRhcHRhYmxlQ29udHJvbGxlciBmcm9tICcuL0FkYXB0YWJsZUNvbnRyb2xsZXInO1xuaW1wb3J0IHsgRmlsZXNBZGFwdGVyIH0gZnJvbSAnLi4vQWRhcHRlcnMvRmlsZXMvRmlsZXNBZGFwdGVyJztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IG1pbWUgZnJvbSAnbWltZSc7XG5cbmNvbnN0IGxlZ2FjeUZpbGVzUmVnZXggPSBuZXcgUmVnRXhwKFxuICAnXlswLTlhLWZBLUZdezh9LVswLTlhLWZBLUZdezR9LVswLTlhLWZBLUZdezR9LVswLTlhLWZBLUZdezR9LVswLTlhLWZBLUZdezEyfS0uKidcbik7XG5cbmV4cG9ydCBjbGFzcyBGaWxlc0NvbnRyb2xsZXIgZXh0ZW5kcyBBZGFwdGFibGVDb250cm9sbGVyIHtcbiAgZ2V0RmlsZURhdGEoY29uZmlnLCBmaWxlbmFtZSkge1xuICAgIHJldHVybiB0aGlzLmFkYXB0ZXIuZ2V0RmlsZURhdGEoZmlsZW5hbWUpO1xuICB9XG5cbiAgY3JlYXRlRmlsZShjb25maWcsIGZpbGVuYW1lLCBkYXRhLCBjb250ZW50VHlwZSkge1xuICAgIGNvbnN0IGV4dG5hbWUgPSBwYXRoLmV4dG5hbWUoZmlsZW5hbWUpO1xuXG4gICAgY29uc3QgaGFzRXh0ZW5zaW9uID0gZXh0bmFtZS5sZW5ndGggPiAwO1xuXG4gICAgaWYgKCFoYXNFeHRlbnNpb24gJiYgY29udGVudFR5cGUgJiYgbWltZS5nZXRFeHRlbnNpb24oY29udGVudFR5cGUpKSB7XG4gICAgICBmaWxlbmFtZSA9IGZpbGVuYW1lICsgJy4nICsgbWltZS5nZXRFeHRlbnNpb24oY29udGVudFR5cGUpO1xuICAgIH0gZWxzZSBpZiAoaGFzRXh0ZW5zaW9uICYmICFjb250ZW50VHlwZSkge1xuICAgICAgY29udGVudFR5cGUgPSBtaW1lLmdldFR5cGUoZmlsZW5hbWUpO1xuICAgIH1cblxuICAgIGlmICghdGhpcy5vcHRpb25zLnByZXNlcnZlRmlsZU5hbWUpIHtcbiAgICAgIGZpbGVuYW1lID0gcmFuZG9tSGV4U3RyaW5nKDMyKSArICdfJyArIGZpbGVuYW1lO1xuICAgIH1cblxuICAgIGNvbnN0IGxvY2F0aW9uID0gdGhpcy5hZGFwdGVyLmdldEZpbGVMb2NhdGlvbihjb25maWcsIGZpbGVuYW1lKTtcbiAgICByZXR1cm4gdGhpcy5hZGFwdGVyLmNyZWF0ZUZpbGUoZmlsZW5hbWUsIGRhdGEsIGNvbnRlbnRUeXBlKS50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICAgICAgICB1cmw6IGxvY2F0aW9uLFxuICAgICAgICBuYW1lOiBmaWxlbmFtZSxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgZGVsZXRlRmlsZShjb25maWcsIGZpbGVuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuYWRhcHRlci5kZWxldGVGaWxlKGZpbGVuYW1lKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kIGZpbGUgcmVmZXJlbmNlcyBpbiBSRVNULWZvcm1hdCBvYmplY3QgYW5kIGFkZHMgdGhlIHVybCBrZXlcbiAgICogd2l0aCB0aGUgY3VycmVudCBtb3VudCBwb2ludCBhbmQgYXBwIGlkLlxuICAgKiBPYmplY3QgbWF5IGJlIGEgc2luZ2xlIG9iamVjdCBvciBsaXN0IG9mIFJFU1QtZm9ybWF0IG9iamVjdHMuXG4gICAqL1xuICBleHBhbmRGaWxlc0luT2JqZWN0KGNvbmZpZywgb2JqZWN0KSB7XG4gICAgaWYgKG9iamVjdCBpbnN0YW5jZW9mIEFycmF5KSB7XG4gICAgICBvYmplY3QubWFwKG9iaiA9PiB0aGlzLmV4cGFuZEZpbGVzSW5PYmplY3QoY29uZmlnLCBvYmopKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBvYmplY3QgIT09ICdvYmplY3QnKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGZvciAoY29uc3Qga2V5IGluIG9iamVjdCkge1xuICAgICAgY29uc3QgZmlsZU9iamVjdCA9IG9iamVjdFtrZXldO1xuICAgICAgaWYgKGZpbGVPYmplY3QgJiYgZmlsZU9iamVjdFsnX190eXBlJ10gPT09ICdGaWxlJykge1xuICAgICAgICBpZiAoZmlsZU9iamVjdFsndXJsJ10pIHtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBmaWxlbmFtZSA9IGZpbGVPYmplY3RbJ25hbWUnXTtcbiAgICAgICAgLy8gYWxsIGZpbGVuYW1lcyBzdGFydGluZyB3aXRoIFwidGZzcy1cIiBzaG91bGQgYmUgZnJvbSBmaWxlcy5wYXJzZXRmc3MuY29tXG4gICAgICAgIC8vIGFsbCBmaWxlbmFtZXMgc3RhcnRpbmcgd2l0aCBhIFwiLVwiIHNlcGVyYXRlZCBVVUlEIHNob3VsZCBiZSBmcm9tIGZpbGVzLnBhcnNlLmNvbVxuICAgICAgICAvLyBhbGwgb3RoZXIgZmlsZW5hbWVzIGhhdmUgYmVlbiBtaWdyYXRlZCBvciBjcmVhdGVkIGZyb20gUGFyc2UgU2VydmVyXG4gICAgICAgIGlmIChjb25maWcuZmlsZUtleSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgZmlsZU9iamVjdFsndXJsJ10gPSB0aGlzLmFkYXB0ZXIuZ2V0RmlsZUxvY2F0aW9uKGNvbmZpZywgZmlsZW5hbWUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGlmIChmaWxlbmFtZS5pbmRleE9mKCd0ZnNzLScpID09PSAwKSB7XG4gICAgICAgICAgICBmaWxlT2JqZWN0Wyd1cmwnXSA9XG4gICAgICAgICAgICAgICdodHRwOi8vZmlsZXMucGFyc2V0ZnNzLmNvbS8nICtcbiAgICAgICAgICAgICAgY29uZmlnLmZpbGVLZXkgK1xuICAgICAgICAgICAgICAnLycgK1xuICAgICAgICAgICAgICBlbmNvZGVVUklDb21wb25lbnQoZmlsZW5hbWUpO1xuICAgICAgICAgIH0gZWxzZSBpZiAobGVnYWN5RmlsZXNSZWdleC50ZXN0KGZpbGVuYW1lKSkge1xuICAgICAgICAgICAgZmlsZU9iamVjdFsndXJsJ10gPVxuICAgICAgICAgICAgICAnaHR0cDovL2ZpbGVzLnBhcnNlLmNvbS8nICtcbiAgICAgICAgICAgICAgY29uZmlnLmZpbGVLZXkgK1xuICAgICAgICAgICAgICAnLycgK1xuICAgICAgICAgICAgICBlbmNvZGVVUklDb21wb25lbnQoZmlsZW5hbWUpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBmaWxlT2JqZWN0Wyd1cmwnXSA9IHRoaXMuYWRhcHRlci5nZXRGaWxlTG9jYXRpb24oY29uZmlnLCBmaWxlbmFtZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZXhwZWN0ZWRBZGFwdGVyVHlwZSgpIHtcbiAgICByZXR1cm4gRmlsZXNBZGFwdGVyO1xuICB9XG5cbiAgZ2V0RmlsZVN0cmVhbShjb25maWcsIGZpbGVuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuYWRhcHRlci5nZXRGaWxlU3RyZWFtKGZpbGVuYW1lKTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBGaWxlc0NvbnRyb2xsZXI7XG4iXX0=