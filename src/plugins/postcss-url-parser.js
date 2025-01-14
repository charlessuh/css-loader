import postcss from 'postcss';
import valueParser from 'postcss-value-parser';

const pluginName = 'postcss-url-parser';

const isUrlFunc = /url/i;
const isImageSetFunc = /^(?:-webkit-)?image-set$/i;
const needParseDecl = /(?:url|(?:-webkit-)?image-set)\(/i;

function getNodeFromUrlFunc(node) {
  return node.nodes && node.nodes[0];
}

function getUrlFromUrlFunc(node) {
  return node.nodes.length !== 0 && node.nodes[0].type === 'string'
    ? node.nodes[0].value
    : valueParser.stringify(node.nodes);
}

function walkUrls(parsed, callback) {
  parsed.walk((node) => {
    if (node.type !== 'function') {
      return;
    }

    if (isUrlFunc.test(node.value)) {
      callback(getNodeFromUrlFunc(node), getUrlFromUrlFunc(node), false);

      // Do not traverse inside `url`
      // eslint-disable-next-line consistent-return
      return false;
    }

    if (isImageSetFunc.test(node.value)) {
      node.nodes.forEach((nNode) => {
        if (nNode.type === 'function' && isUrlFunc.test(nNode.value)) {
          callback(getNodeFromUrlFunc(nNode), getUrlFromUrlFunc(nNode), false);
        }

        if (nNode.type === 'string') {
          callback(nNode, nNode.value, true);
        }
      });

      // Do not traverse inside `image-set`
      // eslint-disable-next-line consistent-return
      return false;
    }
  });
}

function getUrlsFromValue(value, result, filter, decl) {
  if (!needParseDecl.test(value)) {
    return;
  }

  const parsed = valueParser(value);
  const urls = [];

  walkUrls(parsed, (node, url, needQuotes) => {
    if (url.trim().replace(/\\[\r\n]/g, '').length === 0) {
      result.warn(`Unable to find uri in '${decl ? decl.toString() : value}'`, {
        node: decl,
      });

      return;
    }

    if (filter && !filter(url)) {
      return;
    }

    const [normalizedUrl, singleQuery, hashValue] = url.split(/(\?)?#/);
    const hash =
      singleQuery || hashValue
        ? `${singleQuery ? '?' : ''}${hashValue ? `#${hashValue}` : ''}`
        : '';

    urls.push({ node, url: normalizedUrl, hash, needQuotes });
  });

  // eslint-disable-next-line consistent-return
  return { parsed, urls };
}

function walkDecls(css, result, filter) {
  const items = [];

  css.walkDecls((decl) => {
    const item = getUrlsFromValue(decl.value, result, filter, decl);

    if (!item || item.urls.length === 0) {
      return;
    }

    items.push({ decl, parsed: item.parsed, urls: item.urls });
  });

  return items;
}

function flatten(array) {
  return array.reduce((a, b) => a.concat(b), []);
}

function collectUniqueUrlsWithNodes(array) {
  return array.reduce((accumulator, currentValue) => {
    const { url, needQuotes, hash, node } = currentValue;
    const found = accumulator.find(
      (item) =>
        url === item.url && needQuotes === item.needQuotes && hash === item.hash
    );

    if (!found) {
      accumulator.push({ url, hash, needQuotes, nodes: [node] });
    } else {
      found.nodes.push(node);
    }

    return accumulator;
  }, []);
}

export default postcss.plugin(
  pluginName,
  (options) =>
    function process(css, result) {
      const traversed = walkDecls(css, result, options.filter);
      const paths = collectUniqueUrlsWithNodes(
        flatten(traversed.map((item) => item.urls))
      );
      const replacers = new Map();

      paths.forEach((path, index) => {
        const { url, hash, needQuotes, nodes } = path;
        const name = `___CSS_LOADER_URL_IMPORT_${index}___`;

        result.messages.push(
          {
            pluginName,
            type: 'import',
            value: { type: 'url', name, url, needQuotes, hash, index },
          },
          {
            pluginName,
            type: 'replacer',
            value: { type: 'url', name },
          }
        );

        nodes.forEach((node) => {
          replacers.set(node, name);
        });
      });

      traversed.forEach((item) => {
        walkUrls(item.parsed, (node) => {
          const name = replacers.get(node);

          if (!name) {
            return;
          }

          // eslint-disable-next-line no-param-reassign
          node.type = 'word';
          // eslint-disable-next-line no-param-reassign
          node.value = name;
        });

        // eslint-disable-next-line no-param-reassign
        item.decl.value = item.parsed.toString();
      });
    }
);
