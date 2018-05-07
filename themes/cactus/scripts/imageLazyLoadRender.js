'use strict';

hexo.extend.filter.register('after_post_render:html', imageLazyLoadProcess);

const Promise = require('bluebird');
const imageSize = require('image-size');
const imageToGradientSync = require('image-to-gradient');
const streamToArray = require('stream-to-array');

const imageToGradient = Promise.promisify(imageToGradientSync);

const gradientOptions = {
    angle: 0, // gradient angle in degrees
    steps: 10  // number of steps
}

const globalImageMatch = /<img(\s[^>]*?)src\s*=\s*['\"]([^'\"]*?)['\"]([^>]*?)>/gi;
const localImageMatch = /<img(\s[^>]*?)src\s*=\s*['\"]([^'\"]*?)['\"]([^>]*?)>/i;

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function getImageMatch(path) {
    return new RegExp("<img(\\s[^>]*?)src\\s*=\\s*['\"](" + escapeRegExp(path) + ")['\"]([^>]*?)>", 'i');
}


function imageLazyLoadProcess(htmlContent) {
    const hexo = this;
    const config = hexo.theme.config.lazyload;

    if (!config || !config.enable || !/post.ejs$/.test(arguments[1].path)) {
        return htmlContent;
    }

    var matches = htmlContent.match(globalImageMatch);

    if (!matches) {
        return;
    }

    var promises = matches.map(function (match) {
        var match = match.match(localImageMatch);

        if (!match) {
            return;
        }

        var item = { url: match[2] };

        var imageStream = hexo.route.get(item.url);

        return streamToArray(imageStream).then(function (imageArray) {
            var imageBuffer = Buffer.concat(imageArray);

            var size = imageSize(imageBuffer);

            item.width = size.width;
            item.height = size.height;

            return imageToGradient(imageBuffer, gradientOptions).then(function (gradient) {
                item.gradient = gradient;

                return item;
            }, function (error) {
                console.log('Failed to create gradient', error);
            });
        }, function (error) {
            console.log('Failed to stream array', error);
        });
    });

    return Promise.all(promises).then(function (items) {

        var hasLazyLoaded = false;

        items.forEach(function (item) {
            var regex = getImageMatch(item.url);
            htmlContent = htmlContent.replace(regex, function (tag, pre, url, post) {
                // might be duplicate
                if (/data-src/gi.test(tag)) {
                    return tag;
                }
                
                hasLazyLoaded = true;

                var result = '<div class="img-container" style="width:'+item.width+'px;background:' + item.gradient + '">' +
                                '<img' + pre + 'data-src="' + url + '"' + post + 
                                    ' height="' + item.height + '" width="' + item.width + '" style="padding-top:' + (item.height / item.width * 100) + '%">' +
                             '</div>';

                if (config.noscript) {
                    result = '<noscript><img' + pre + 'src="' + url + '"' + post + ' height="' + item.height + '" width="' + item.width + '"></noscript>' + result;
                }

                return result;
            });
        });

        if (hasLazyLoaded) {
            htmlContent += '<script type="text/javascript" src="/js/imageLazyLoad.js"></script>';

            if (config.noscript) {
                htmlContent += '<noscript><style>.img-container { display: none !important; }</style></noscript>';
            }
        }

        return htmlContent;
    });
}