import { describe, it, expect } from 'vitest';
import {
    extractPathParameters,
    updatePathParameterNameInPath,
    updatePathParameterDefaultValueInPath,
    removePathParameterFromPath,
    replacePathParametersWithValues,
    validatePathUniqueness,
    sanitizePathParameterName,
    convertPathToRouterFormat,
    normalizePathForComparison,
    replacePathParametersWithDefaults,
} from './urlParametersParsing';

describe('urlParametersParsing', () => {
    describe('extractPathParameters', () => {
        it('should extract simple parameter', () => {
            const result = extractPathParameters('products/{{id|}}', {});
            expect(result).toEqual([{ name: 'id', value: '', defaultValue: '' }]);
        });

        it('should extract parameter with default value', () => {
            const result = extractPathParameters('products/{{id|123}}', {});
            expect(result).toEqual([{ name: 'id', value: '123', defaultValue: '123' }]);
        });

        it('should use provided value over default', () => {
            const result = extractPathParameters('products/{{id|123}}', { id: '456' });
            expect(result).toEqual([{ name: 'id', value: '456', defaultValue: '123' }]);
        });

        it('should extract multiple parameters', () => {
            const result = extractPathParameters('{{category|}}/{{id|}}', {});
            expect(result).toEqual([
                { name: 'category', value: '', defaultValue: '' },
                { name: 'id', value: '', defaultValue: '' },
            ]);
        });

        it('should support dashes in parameter names', () => {
            const result = extractPathParameters('products/{{product-id|}}', {});
            expect(result).toEqual([{ name: 'product-id', value: '', defaultValue: '' }]);
        });

        it('should support dashes in parameter names with default values', () => {
            const result = extractPathParameters('{{category-name|electronics}}/{{product-id|123}}', {
                'product-id': '456',
            });
            expect(result).toEqual([
                { name: 'category-name', value: 'electronics', defaultValue: 'electronics' },
                { name: 'product-id', value: '456', defaultValue: '123' },
            ]);
        });

        it('should support multiple dashes in parameter names', () => {
            const result = extractPathParameters('{{my-long-param-name|default}}', {});
            expect(result).toEqual([{ name: 'my-long-param-name', value: 'default', defaultValue: 'default' }]);
        });

        it('should support underscores and dashes together', () => {
            const result = extractPathParameters('{{my_param-name|}}', { 'my_param-name': 'value' });
            expect(result).toEqual([{ name: 'my_param-name', value: 'value', defaultValue: '' }]);
        });

        it('should return empty array for path without parameters', () => {
            const result = extractPathParameters('products/electronics', {});
            expect(result).toEqual([]);
        });

        describe('special characters handling', () => {
            it('should allow @ symbol in parameter name', () => {
                const result = extractPathParameters('users/{{user@name|}}', {});
                expect(result).toEqual([{ name: 'user@name', value: '', defaultValue: '' }]);
            });

            it('should allow accented characters (é) in parameter name', () => {
                const result = extractPathParameters('products/{{catégorie|}}', {});
                expect(result).toEqual([{ name: 'catégorie', value: '', defaultValue: '' }]);
            });

            it('should allow double quotes in parameter name', () => {
                const result = extractPathParameters('products/{{my"param|}}', {});
                expect(result).toEqual([{ name: 'my"param', value: '', defaultValue: '' }]);
            });

            it('should allow single quotes in parameter name', () => {
                const result = extractPathParameters("products/{{my'param|}}", {});
                expect(result).toEqual([{ name: "my'param", value: '', defaultValue: '' }]);
            });

            it('should allow spaces in parameter name', () => {
                const result = extractPathParameters('products/{{my param|}}', {});
                expect(result).toEqual([{ name: 'my param', value: '', defaultValue: '' }]);
            });

            it('should allow dots in parameter name', () => {
                const result = extractPathParameters('products/{{my.param|}}', {});
                expect(result).toEqual([{ name: 'my.param', value: '', defaultValue: '' }]);
            });

            it('should allow slashes in parameter name', () => {
                const result = extractPathParameters('products/{{my/param|}}', {});
                expect(result).toEqual([{ name: 'my/param', value: '', defaultValue: '' }]);
            });

            it('should allow colons in parameter name', () => {
                const result = extractPathParameters('products/{{my:param|}}', {});
                expect(result).toEqual([{ name: 'my:param', value: '', defaultValue: '' }]);
            });

            it('should allow ampersand in parameter name', () => {
                const result = extractPathParameters('products/{{my&param|}}', {});
                expect(result).toEqual([{ name: 'my&param', value: '', defaultValue: '' }]);
            });

            it('should allow equals sign in parameter name', () => {
                const result = extractPathParameters('products/{{my=param|}}', {});
                expect(result).toEqual([{ name: 'my=param', value: '', defaultValue: '' }]);
            });

            it('should allow question mark in parameter name', () => {
                const result = extractPathParameters('products/{{my?param|}}', {});
                expect(result).toEqual([{ name: 'my?param', value: '', defaultValue: '' }]);
            });

            it('should allow hash in parameter name', () => {
                const result = extractPathParameters('products/{{my#param|}}', {});
                expect(result).toEqual([{ name: 'my#param', value: '', defaultValue: '' }]);
            });

            it('should allow percent in parameter name', () => {
                const result = extractPathParameters('products/{{my%param|}}', {});
                expect(result).toEqual([{ name: 'my%param', value: '', defaultValue: '' }]);
            });

            it('should allow brackets in parameter name', () => {
                const result = extractPathParameters('products/{{my[param]|}}', {});
                expect(result).toEqual([{ name: 'my[param]', value: '', defaultValue: '' }]);
            });

            it('should not match parameter with closing brace in name', () => {
                const result = extractPathParameters('products/{{my}param|}}', {});
                expect(result).toEqual([]);
            });

            it('should allow opening brace in parameter name', () => {
                const result = extractPathParameters('products/{{my{param|}}', {});
                expect(result).toEqual([{ name: 'my{param', value: '', defaultValue: '' }]);
            });

            it('should allow backslash in parameter name', () => {
                const result = extractPathParameters('products/{{my\\param|}}', {});
                expect(result).toEqual([{ name: 'my\\param', value: '', defaultValue: '' }]);
            });

            it('should treat pipe as separator - not allowed in parameter name', () => {
                const result = extractPathParameters('products/{{my|param|default}}', {});
                expect(result).toEqual([{ name: 'my', value: 'param|default', defaultValue: 'param|default' }]);
            });

            it('should allow special characters in default values', () => {
                const result = extractPathParameters('products/{{id|default@value}}', {});
                expect(result).toEqual([{ name: 'id', value: 'default@value', defaultValue: 'default@value' }]);
            });

            it('should allow accented characters in default values', () => {
                const result = extractPathParameters('products/{{id|café}}', {});
                expect(result).toEqual([{ name: 'id', value: 'café', defaultValue: 'café' }]);
            });

            it('should allow spaces in default values', () => {
                const result = extractPathParameters('products/{{id|hello world}}', {});
                expect(result).toEqual([{ name: 'id', value: 'hello world', defaultValue: 'hello world' }]);
            });

            it('should allow emoji in parameter name', () => {
                const result = extractPathParameters('products/{{my🎉param|}}', {});
                expect(result).toEqual([{ name: 'my🎉param', value: '', defaultValue: '' }]);
            });

            it('should allow Chinese characters in parameter name', () => {
                const result = extractPathParameters('products/{{产品|}}', {});
                expect(result).toEqual([{ name: '产品', value: '', defaultValue: '' }]);
            });

            it('should allow Arabic characters in parameter name', () => {
                const result = extractPathParameters('products/{{منتج|}}', {});
                expect(result).toEqual([{ name: 'منتج', value: '', defaultValue: '' }]);
            });

            it('should extract all parameters including those with special chars', () => {
                const result = extractPathParameters('{{valid-param|}}/{{user@email|}}/{{also_valid|}}', {});
                expect(result).toEqual([
                    { name: 'valid-param', value: '', defaultValue: '' },
                    { name: 'user@email', value: '', defaultValue: '' },
                    { name: 'also_valid', value: '', defaultValue: '' },
                ]);
            });

            it('should handle parameter starting with dash', () => {
                const result = extractPathParameters('products/{{-starts-with-dash|}}', {});
                expect(result).toEqual([{ name: '-starts-with-dash', value: '', defaultValue: '' }]);
            });

            it('should handle parameter ending with dash', () => {
                const result = extractPathParameters('products/{{ends-with-dash-|}}', {});
                expect(result).toEqual([{ name: 'ends-with-dash-', value: '', defaultValue: '' }]);
            });

            it('should handle parameter with only dashes', () => {
                const result = extractPathParameters('products/{{---|}}', {});
                expect(result).toEqual([{ name: '---', value: '', defaultValue: '' }]);
            });

            it('should handle parameter with consecutive dashes', () => {
                const result = extractPathParameters('products/{{my--param|}}', {});
                expect(result).toEqual([{ name: 'my--param', value: '', defaultValue: '' }]);
            });

            it('should not match empty parameter name', () => {
                const result = extractPathParameters('products/{{|default}}', {});
                expect(result).toEqual([]);
            });
        });
    });

    describe('updatePathParameterNameInPath', () => {
        it('should update parameter name at index', () => {
            const result = updatePathParameterNameInPath('{{old|}}/{{other|}}', 0, 'new');
            expect(result).toBe('{{new|}}/{{other|}}');
        });

        it('should preserve default value when updating name', () => {
            const result = updatePathParameterNameInPath('{{old|default}}', 0, 'new');
            expect(result).toBe('{{new|default}}');
        });

        it('should update correct parameter by index', () => {
            const result = updatePathParameterNameInPath('{{first|}}/{{second|}}/{{third|}}', 1, 'updated');
            expect(result).toBe('{{first|}}/{{updated|}}/{{third|}}');
        });

        it('should support dashes in new parameter name', () => {
            const result = updatePathParameterNameInPath('{{old|}}', 0, 'new-name');
            expect(result).toBe('{{new-name|}}');
        });

        it('should update parameter with dashes in name', () => {
            const result = updatePathParameterNameInPath('{{old-name|default}}', 0, 'new-name');
            expect(result).toBe('{{new-name|default}}');
        });
    });

    describe('updatePathParameterDefaultValueInPath', () => {
        it('should update default value at index', () => {
            const result = updatePathParameterDefaultValueInPath('{{param|old}}', 0, 'new');
            expect(result).toBe('{{param|new}}');
        });

        it('should add default value where none existed', () => {
            const result = updatePathParameterDefaultValueInPath('{{param|}}', 0, 'default');
            expect(result).toBe('{{param|default}}');
        });

        it('should update correct parameter by index', () => {
            const result = updatePathParameterDefaultValueInPath('{{a|1}}/{{b|2}}', 1, '99');
            expect(result).toBe('{{a|1}}/{{b|99}}');
        });

        it('should work with dashed parameter names', () => {
            const result = updatePathParameterDefaultValueInPath('{{my-param|old}}', 0, 'new');
            expect(result).toBe('{{my-param|new}}');
        });
    });

    describe('removePathParameterFromPath', () => {
        it('should remove parameter at index', () => {
            const result = removePathParameterFromPath('products/{{id|}}', 0);
            expect(result).toBe('products');
        });

        it('should remove correct parameter by index', () => {
            const result = removePathParameterFromPath('{{a|}}/{{b|}}/{{c|}}', 1);
            expect(result).toBe('{{a|}}/{{c|}}');
        });

        it('should clean up double slashes', () => {
            const result = removePathParameterFromPath('a/{{b|}}/c', 0);
            expect(result).toBe('a/c');
        });

        it('should remove trailing slash', () => {
            const result = removePathParameterFromPath('{{a|}}/', 0);
            expect(result).toBe('');
        });

        it('should work with dashed parameter names', () => {
            const result = removePathParameterFromPath('products/{{product-id|}}', 0);
            expect(result).toBe('products');
        });
    });

    describe('replacePathParametersWithValues', () => {
        it('should replace parameter with value', () => {
            const result = replacePathParametersWithValues('products/{{id|}}', { id: '123' });
            expect(result).toBe('products/123');
        });

        it('should use default value when no value provided', () => {
            const result = replacePathParametersWithValues('products/{{id|default}}', {});
            expect(result).toBe('products/default');
        });

        it('should show placeholder when no value or default', () => {
            const result = replacePathParametersWithValues('products/{{id|}}', {});
            expect(result).toBe('products/{{id}}');
        });

        it('should handle case-insensitive parameter matching', () => {
            const result = replacePathParametersWithValues('products/{{ID|}}', { ID: '123' });
            expect(result).toBe('products/123');
        });

        it('should work with dashed parameter names', () => {
            const result = replacePathParametersWithValues('products/{{product-id|}}', { 'product-id': '456' });
            expect(result).toBe('products/456');
        });

        it('should replace multiple dashed parameters', () => {
            const result = replacePathParametersWithValues('{{category-name|}}/{{product-id|}}', {
                'category-name': 'electronics',
                'product-id': '123',
            });
            expect(result).toBe('electronics/123');
        });

        it('should URL encode spaces in values', () => {
            const result = replacePathParametersWithValues('products/{{name|}}', { name: 'hello world' });
            expect(result).toBe('products/hello%20world');
        });

        it('should URL encode special characters in values', () => {
            const result = replacePathParametersWithValues('users/{{email|}}', { email: 'test@example.com' });
            expect(result).toBe('users/test%40example.com');
        });

        it('should URL encode accented characters in values', () => {
            const result = replacePathParametersWithValues('products/{{name|}}', { name: 'café' });
            expect(result).toBe('products/caf%C3%A9');
        });

        it('should URL encode default values', () => {
            const result = replacePathParametersWithValues('products/{{name|hello world}}', {});
            expect(result).toBe('products/hello%20world');
        });

        it('should URL encode emoji in values', () => {
            const result = replacePathParametersWithValues('products/{{name|}}', { name: 'fun🎉' });
            expect(result).toBe('products/fun%F0%9F%8E%89');
        });

        it('should URL encode Chinese characters in values', () => {
            const result = replacePathParametersWithValues('products/{{name|}}', { name: '产品' });
            expect(result).toBe('products/%E4%BA%A7%E5%93%81');
        });
    });

    describe('validatePathUniqueness', () => {
        const pages = [
            { id: '1', name: 'Products', paths: { en: 'products/{{id|}}' } },
            { id: '2', name: 'Categories', paths: { en: 'categories/{{slug|}}' } },
            { id: '3', name: 'About', paths: { en: 'about' } },
        ];

        it('should return true for unique path', () => {
            const result = validatePathUniqueness('blog/{{id|}}', '4', pages, 'en');
            expect(result).toBe(true);
        });

        it('should return true for empty path', () => {
            const result = validatePathUniqueness('', '4', pages, 'en');
            expect(result).toBe(true);
        });

        it('should return error for conflicting path', () => {
            const result = validatePathUniqueness('products/{{slug|}}', '4', pages, 'en');
            expect(result).toBe('URL path already used by "Products" page.');
        });

        it('should allow same path for same page', () => {
            const result = validatePathUniqueness('products/{{id|}}', '1', pages, 'en');
            expect(result).toBe(true);
        });

        it('should work with dashed parameter names', () => {
            const pagesWithDash = [{ id: '1', name: 'Products', paths: { en: 'products/{{product-id|}}' } }];
            const result = validatePathUniqueness('products/{{other-id|}}', '2', pagesWithDash, 'en');
            expect(result).toBe('URL path already used by "Products" page.');
        });
    });

    describe('sanitizePathParameterName', () => {
        it('should return valid name unchanged', () => {
            expect(sanitizePathParameterName('my-param')).toBe('my-param');
        });

        it('should remove pipe character', () => {
            expect(sanitizePathParameterName('my|param')).toBe('myparam');
        });

        it('should remove closing brace character', () => {
            expect(sanitizePathParameterName('my}param')).toBe('myparam');
        });

        it('should remove multiple invalid characters', () => {
            expect(sanitizePathParameterName('my|param}name')).toBe('myparamname');
        });

        it('should return empty string if only invalid characters', () => {
            expect(sanitizePathParameterName('|}|}')).toBe('');
        });

        it('should preserve special characters that are allowed', () => {
            expect(sanitizePathParameterName('user@email')).toBe('user@email');
            expect(sanitizePathParameterName('catégorie')).toBe('catégorie');
            expect(sanitizePathParameterName('my param')).toBe('my param');
            expect(sanitizePathParameterName('emoji🎉')).toBe('emoji🎉');
            expect(sanitizePathParameterName('产品')).toBe('产品');
        });

        it('should handle mixed valid and invalid characters', () => {
            expect(sanitizePathParameterName('valid|invalid}ok')).toBe('validinvalidok');
        });
    });

    describe('convertPathToRouterFormat', () => {
        it('should convert simple parameter to router format', () => {
            const result = convertPathToRouterFormat('products/{{id|}}');
            expect(result).toBe('products/:id');
        });

        it('should convert parameter with default value', () => {
            const result = convertPathToRouterFormat('products/{{id|123}}');
            expect(result).toBe('products/:id');
        });

        it('should convert multiple parameters', () => {
            const result = convertPathToRouterFormat('{{category|}}/{{id|}}');
            expect(result).toBe(':category/:id');
        });

        it('should convert dashed parameter names', () => {
            const result = convertPathToRouterFormat('products/{{product-id|}}');
            expect(result).toBe('products/:product-id');
        });

        it('should convert multiple dashed parameters', () => {
            const result = convertPathToRouterFormat('{{category-name|}}/{{product-id|123}}');
            expect(result).toBe(':category-name/:product-id');
        });

        it('should return path unchanged if no parameters', () => {
            const result = convertPathToRouterFormat('products/electronics');
            expect(result).toBe('products/electronics');
        });

        it('should handle path starting with slash', () => {
            const result = convertPathToRouterFormat('/products/{{id|}}');
            expect(result).toBe('/products/:id');
        });
    });

    describe('normalizePathForComparison', () => {
        it('should replace parameter with empty placeholder', () => {
            const result = normalizePathForComparison('products/{{id|}}');
            expect(result).toBe('products/{{}}');
        });

        it('should replace parameter with default value', () => {
            const result = normalizePathForComparison('products/{{id|123}}');
            expect(result).toBe('products/{{}}');
        });

        it('should replace multiple parameters', () => {
            const result = normalizePathForComparison('{{category|}}/{{id|}}');
            expect(result).toBe('{{}}/{{}}');
        });

        it('should handle dashed parameter names', () => {
            const result = normalizePathForComparison('products/{{product-id|}}');
            expect(result).toBe('products/{{}}');
        });

        it('should return path unchanged if no parameters', () => {
            const result = normalizePathForComparison('products/electronics');
            expect(result).toBe('products/electronics');
        });
    });

    describe('replacePathParametersWithDefaults', () => {
        it('should replace parameter with default value', () => {
            const result = replacePathParametersWithDefaults('products/{{id|123}}');
            expect(result).toBe('products/123');
        });

        it('should show placeholder when no default value', () => {
            const result = replacePathParametersWithDefaults('products/{{id|}}');
            expect(result).toBe('products/{{id}}');
        });

        it('should handle dashed parameter names with default', () => {
            const result = replacePathParametersWithDefaults('link/{{character-id|foo}}');
            expect(result).toBe('link/foo');
        });

        it('should handle dashed parameter names without default', () => {
            const result = replacePathParametersWithDefaults('link/{{character-id|}}');
            expect(result).toBe('link/{{character-id}}');
        });

        it('should handle multiple parameters', () => {
            const result = replacePathParametersWithDefaults('{{category|books}}/{{id|123}}');
            expect(result).toBe('books/123');
        });

        it('should lowercase the path', () => {
            const result = replacePathParametersWithDefaults('Products/{{ID|ABC}}');
            expect(result).toBe('products/abc');
        });
    });
});
