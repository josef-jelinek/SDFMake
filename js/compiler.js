const LIST_EXPANSION_LIMIT = 4096;

export function defaultScript() {
    return [
        "# SDFMake modelling script",
        "",
        "let sphere_radius = 8",
        "let blend = 4",
        "",
        "# colors in linear space - dark shades compressed",
        "let dark = [0.025, 0.015, 0.02]",
        "let cream = [0.6, 0.5, 0.4]",
        "let red = [0.6, 0, 0]",
        "let green = [0, 0.4, 0]",
        "let blue = [0.01, 0.01, 0.7]",
        "let yellow = [0.5, 0.3, 0]",
        "let cyan = [0, 0.25, 0.4]",
        "let magenta = [0.4, 0.01, 0.5]",
        "",
        "let base = smooth_subtract(",
        "    color(chamfer_cylinder([0, 0, 14], 32, 28, 4), dark),",
        "    torus([0, 0, 8], 35, 5),",
        "    10,",
        ")",
        "",
        "let pyramid = smooth_union(",
        "    smooth_union( # bottom",
        "        color(sphere([-16, -9.237, 36], sphere_radius), cyan),",
        "        color(sphere([0, -9.237, 36], sphere_radius), blue),",
        "        color(sphere([16, -9.237, 36], sphere_radius), magenta),",
        "        color(sphere([-8, 4.619, 36], sphere_radius), green),",
        "        color(sphere([8, 4.619, 36], sphere_radius), red),",
        "        color(sphere([0, 18.475, 36], sphere_radius), yellow),",
        "        blend,",
        "    ),",
        "    smooth_union( # middle",
        "        color(sphere([-8, -4.619, 49.064], sphere_radius), red),",
        "        color(sphere([8, -4.619, 49.064], sphere_radius), green),",
        "        color(sphere([0, 9.237, 49.064], sphere_radius), blue),",
        "        blend,",
        "    ),",
        "    color(sphere([0, 0, 62.128], sphere_radius), cream), # top",
        "    blend,",
        ")",
        "",
        "smooth_union(base, pyramid, blend)",
    ].join("\n");
}

export function parseScript(source) {
    let result = {
        ok: true,
        names: [],
        exprs: [],
        macros: [],
        rootExpr: null,
        errors: []
    };
    let errors = [];
    let tokens = scanTokens(source, errors);
    let cursor = {
        tokens: tokens,
        index: 0,
        errors: errors
    };

    while (!isCurrentToken(cursor, "eof")) {
        let startIndex = cursor.index;
        parseStatement(result, cursor);

        if (cursor.index === startIndex) {
            cursor.index += 1;
        }
    }

    result.errors = cursor.errors;
    result.ok = result.errors.length <= 0 && result.rootExpr !== null;

    if (result.rootExpr === null) {
        result.errors.push("No render expression was found.");
    }

    return result;
}

function parseStatement(result, cursor) {
    let nameToken = currentToken(cursor);

    if (result.rootExpr !== null) {
        addError(cursor, nameToken, "The render expression must be the final top-level item.");
        synchronizeStatement(cursor);
        return;
    }

    if (isCurrentIdentifier(cursor, "let")) {
        parseLetStatement(result, cursor);
        return;
    }

    if (nameToken.kind === "identifier" && isCurrentTokenAt(cursor, 1, "equal")) {
        addError(cursor, nameToken, "Expected 'let' before assignment.");
        synchronizeStatement(cursor);
        return;
    }

    if (nameToken.kind === "identifier" && isCurrentTokenAt(cursor, 1, "left_paren") && isMacroDeclarationStart(cursor)) {
        addError(cursor, nameToken, "Expected 'let' before macro declaration.");
        advanceToken(cursor);
        synchronizeStatement(cursor);
        return;
    }

    parseRenderExpression(result, cursor);
}

function parseRenderExpression(result, cursor) {
    result.rootExpr = parseExpr(cursor);
}

function parseLetStatement(result, cursor) {
    let nameToken = null;
    let expr = null;

    advanceToken(cursor);
    nameToken = currentToken(cursor);

    if (nameToken.kind !== "identifier") {
        addError(cursor, nameToken, "Expected an assignment name after 'let'.");
        synchronizeStatement(cursor);
        return;
    }

    if (nameToken.text === "let") {
        addError(cursor, nameToken, "'let' cannot be used as an assignment name.");
    }

    advanceToken(cursor);

    if (isCurrentToken(cursor, "left_paren")) {
        parseMacroStatement(result, cursor, nameToken);
        return;
    }

    if (!matchToken(cursor, "equal")) {
        addError(cursor, currentToken(cursor), "Expected '=' after assignment name.");
        synchronizeStatement(cursor);
        return;
    }

    expr = parseExpr(cursor);
    result.names.push(nameToken.text);
    result.exprs.push(expr);
}

function parseMacroStatement(result, cursor, nameToken) {
    let macro = {
        name: nameToken.text,
        params: [],
        body: null
    };

    if (isBuiltInCallName(nameToken.text.toLowerCase())) {
        addError(cursor, nameToken, "Macro name '" + nameToken.text + "' conflicts with a built-in function.");
    }

    if (findMacroIndex(result, nameToken.text) >= 0) {
        addError(cursor, nameToken, "Macro '" + nameToken.text + "' is already defined.");
    }

    if (findAssignmentIndex(result, nameToken.text) >= 0) {
        addError(cursor, nameToken, "Macro name '" + nameToken.text + "' conflicts with an assignment.");
    }

    matchToken(cursor, "left_paren");
    parseParameterList(macro, cursor);

    if (!matchToken(cursor, "right_paren")) {
        addError(cursor, currentToken(cursor), "Expected ')' after macro parameters.");
        synchronizeStatement(cursor);
        return;
    }

    if (!matchToken(cursor, "equal")) {
        addError(cursor, currentToken(cursor), "Expected '=' before macro body.");
        synchronizeStatement(cursor);
        return;
    }

    macro.body = parseExpr(cursor);
    result.macros.push(macro);
}

function parseParameterList(macro, cursor) {
    let keepParsing = true;
    let token = null;

    if (isCurrentToken(cursor, "right_paren")) {
        return;
    }

    while (keepParsing && !isCurrentToken(cursor, "eof")) {
        token = currentToken(cursor);

        if (token.kind !== "identifier") {
            addError(cursor, token, "Expected a parameter name.");
            synchronizeStatement(cursor);
            return;
        }

        if (nameListContains(macro.params, token.text)) {
            addError(cursor, token, "Parameter '" + token.text + "' is already defined.");
        }

        macro.params.push(token.text);
        advanceToken(cursor);

        if (matchToken(cursor, "comma")) {
            keepParsing = !isCurrentToken(cursor, "right_paren");
        } else {
            keepParsing = false;
        }
    }
}

function parseExpr(cursor) {
    let token = currentToken(cursor);
    let expr = null;

    if (matchToken(cursor, "left_brace")) {
        return parseBlockExpr(cursor, token);
    }

    if (isCurrentIdentifier(cursor, "for")) {
        return parseForExpr(cursor);
    }

    if (matchToken(cursor, "left_bracket")) {
        expr = {
            kind: "list",
            args: []
        };

        parseListItems(expr, cursor);

        if (!matchToken(cursor, "right_bracket")) {
            addError(cursor, currentToken(cursor), "Expected ']' after list.");
        }

        return expr;
    }

    if (matchToken(cursor, "number")) {
        return {
            kind: "number",
            value: token.value
        };
    }

    if (matchToken(cursor, "identifier")) {
        if (matchToken(cursor, "left_paren")) {
            expr = {
                kind: "call",
                name: token.text,
                args: []
            };

            if (!isCurrentToken(cursor, "right_paren")) {
                parseCallArgumentList(expr, cursor);
            }

            if (!matchToken(cursor, "right_paren")) {
                addError(cursor, currentToken(cursor), "Expected ')' after arguments.");
            }

            return expr;
        }

        return {
            kind: "name",
            name: token.text
        };
    }

    addError(cursor, token, "Expected a number, list, shape name, or function call.");
    advanceToken(cursor);

    return {
        kind: "number",
        value: 0.0
    };
}

function parseForExpr(cursor) {
    let token = currentToken(cursor);
    let nameToken = null;
    let expr = null;

    matchIdentifier(cursor, "for");
    nameToken = currentToken(cursor);

    if (nameToken.kind !== "identifier") {
        addError(cursor, nameToken, "Expected a loop variable name.");
        advanceToken(cursor);

        return {
            kind: "list",
            args: []
        };
    }

    advanceToken(cursor);

    if (matchToken(cursor, "equal")) {
        expr = {
            kind: "for_range",
            name: nameToken.text,
            start: null,
            end: null,
            step: {
                kind: "number",
                value: 1.0
            },
            body: null
        };
        expr.start = parseExpr(cursor);

        if (!matchIdentifier(cursor, "to")) {
            addError(cursor, currentToken(cursor), "Expected 'to' in range loop.");
            synchronizeStatement(cursor);
            return expr;
        }

        expr.end = parseExpr(cursor);

        if (matchIdentifier(cursor, "step")) {
            expr.step = parseExpr(cursor);
        }

        expr.body = parseExpr(cursor);

        return expr;
    }

    if (matchIdentifier(cursor, "in")) {
        expr = {
            kind: "for_each",
            name: nameToken.text,
            list: parseExpr(cursor),
            body: null
        };
        expr.body = parseExpr(cursor);

        return expr;
    }

    addError(cursor, currentToken(cursor), "Expected '=' or 'in' after loop variable.");
    synchronizeStatement(cursor);

    return {
        kind: "list",
        args: []
    };
}

function parseBlockExpr(cursor, token) {
    let expr = {
        kind: "block",
        names: [],
        exprs: [],
        resultIndex: -1
    };

    while (!isCurrentToken(cursor, "right_brace") && !isCurrentToken(cursor, "eof")) {
        let startIndex = cursor.index;

        if (expr.resultIndex >= 0) {
            addError(cursor, currentToken(cursor), "The block result expression must be the final block item.");
            synchronizeBlockAssignment(cursor);
        } else {
            parseBlockItem(expr, cursor);
        }

        if (cursor.index === startIndex) {
            cursor.index += 1;
        }
    }

    if (!matchToken(cursor, "right_brace")) {
        addError(cursor, token, "Expected '}' after block.");
    }

    return expr;
}

function parseBlockItem(block, cursor) {
    if (isCurrentIdentifier(cursor, "let")) {
        parseBlockAssignment(block, cursor);
        return;
    }

    block.names.push("");
    block.exprs.push(parseExpr(cursor));
    block.resultIndex = block.exprs.length - 1;
}

function parseBlockAssignment(block, cursor) {
    let letToken = currentToken(cursor);
    let nameToken = null;
    let expr = null;

    if (!isCurrentIdentifier(cursor, "let")) {
        addError(cursor, letToken, "Expected 'let' before block assignment.");
        synchronizeBlockAssignment(cursor);
        return;
    }

    advanceToken(cursor);
    nameToken = currentToken(cursor);

    if (nameToken.kind !== "identifier") {
        addError(cursor, nameToken, "Expected a block assignment name after 'let'.");
        synchronizeBlockAssignment(cursor);
        return;
    }

    if (nameToken.text === "let") {
        addError(cursor, nameToken, "'let' cannot be used as a block assignment name.");
    }

    advanceToken(cursor);

    if (isCurrentToken(cursor, "left_paren")) {
        addError(cursor, currentToken(cursor), "Macro declarations are only allowed at the top level.");
        synchronizeBlockAssignment(cursor);
        return;
    }

    if (!matchToken(cursor, "equal")) {
        addError(cursor, currentToken(cursor), "Expected '=' after block assignment name.");
        synchronizeBlockAssignment(cursor);
        return;
    }

    expr = parseExpr(cursor);
    block.names.push(nameToken.text);
    block.exprs.push(expr);
}

function parseListItems(expr, cursor) {
    let keepParsing = true;

    if (isCurrentToken(cursor, "right_bracket")) {
        return;
    }

    while (keepParsing && !isCurrentToken(cursor, "eof")) {
        expr.args.push(parseExpr(cursor));

        if (matchToken(cursor, "comma")) {
            keepParsing = !isCurrentToken(cursor, "right_bracket");
        } else {
            keepParsing = false;
        }
    }
}

function parseCallArgumentList(expr, cursor) {
    let keepParsing = true;

    while (keepParsing && !isCurrentToken(cursor, "eof")) {
        if (matchToken(cursor, "ellipsis")) {
            expr.args.push({
                kind: "spread",
                expr: parseExpr(cursor)
            });
        } else {
            expr.args.push(parseExpr(cursor));
        }

        if (matchToken(cursor, "comma")) {
            keepParsing = !isCurrentToken(cursor, "right_paren");
        } else {
            keepParsing = false;
        }
    }
}

function scanTokens(source, errors) {
    let tokens = [];
    let index = 0;
    let line = 1;
    let column = 1;

    while (index < source.length) {
        let ch = source.charAt(index);

        if (ch === " " || ch === "\r" || ch === "\t") {
            index += 1;
            column += 1;
        } else if (ch === "\n") {
            index += 1;
            line += 1;
            column = 1;
        } else if (ch === "#") {
            index = skipLineComment(source, index);
            column = 1;
            line += 1;
        } else if (ch === "/" && source.charAt(index + 1) === "/") {
            index = skipLineComment(source, index);
            column = 1;
            line += 1;
        } else if (ch === "." && source.charAt(index + 1) === "." && source.charAt(index + 2) === ".") {
            tokens.push({
                kind: "ellipsis",
                text: "...",
                line: line,
                column: column
            });
            index += 3;
            column += 3;
        } else if (isIdentifierStart(ch)) {
            index = scanIdentifier(source, tokens, index, line, column);
            column = tokens[tokens.length - 1].column + tokens[tokens.length - 1].text.length;
        } else if (isNumberStart(source, index)) {
            index = scanNumber(source, tokens, errors, index, line, column);
            column = tokens[tokens.length - 1].column + tokens[tokens.length - 1].text.length;
        } else {
            let tokenKind = punctuationKind(ch);

            if (tokenKind === "") {
                errors.push("Line " + line + ", column " + column + ": unexpected character '" + ch + "'.");
                index += 1;
                column += 1;
            } else {
                tokens.push({
                    kind: tokenKind,
                    text: ch,
                    line: line,
                    column: column
                });
                index += 1;
                column += 1;
            }
        }
    }

    tokens.push({
        kind: "eof",
        text: "",
        line: line,
        column: column
    });

    return tokens;
}

function skipLineComment(source, index) {
    let cursor = index;

    while (cursor < source.length && source.charAt(cursor) !== "\n") {
        cursor += 1;
    }

    if (cursor < source.length && source.charAt(cursor) === "\n") {
        cursor += 1;
    }

    return cursor;
}

function scanIdentifier(source, tokens, index, line, column) {
    let start = index;

    while (index < source.length && isIdentifierPart(source.charAt(index))) {
        index += 1;
    }

    tokens.push({
        kind: "identifier",
        text: source.slice(start, index),
        line: line,
        column: column
    });

    return index;
}

function scanNumber(source, tokens, errors, index, line, column) {
    let start = index;
    let text = "";
    let value = 0.0;

    if (source.charAt(index) === "-" || source.charAt(index) === "+") {
        index += 1;
    }

    while (index < source.length && isDigit(source.charAt(index))) {
        index += 1;
    }

    if (source.charAt(index) === ".") {
        index += 1;

        while (index < source.length && isDigit(source.charAt(index))) {
            index += 1;
        }
    }

    if (source.charAt(index) === "e" || source.charAt(index) === "E") {
        index += 1;

        if (source.charAt(index) === "-" || source.charAt(index) === "+") {
            index += 1;
        }

        while (index < source.length && isDigit(source.charAt(index))) {
            index += 1;
        }
    }

    text = source.slice(start, index);
    value = Number(text);

    if (!Number.isFinite(value)) {
        errors.push("Line " + line + ", column " + column + ": invalid number '" + text + "'.");
        value = 0.0;
    }

    tokens.push({
        kind: "number",
        text: text,
        value: value,
        line: line,
        column: column
    });

    return index;
}

function synchronizeStatement(cursor) {
    while (!isCurrentToken(cursor, "eof")) {
        if (tokenStartsStatement(cursor, 0)) {
            return;
        }

        advanceToken(cursor);
    }
}

function synchronizeBlockAssignment(cursor) {
    while (!isCurrentToken(cursor, "eof") && !isCurrentToken(cursor, "right_brace")) {
        if (tokenStartsLetAssignment(cursor, 0)) {
            return;
        }

        advanceToken(cursor);
    }
}

function addError(cursor, token, message) {
    cursor.errors.push("Line " + token.line + ", column " + token.column + ": " + message);
}

function currentToken(cursor) {
    return cursor.tokens[cursor.index];
}

function peekToken(cursor, offset) {
    let index = cursor.index + offset;

    if (index >= cursor.tokens.length) {
        return cursor.tokens[cursor.tokens.length - 1];
    }

    return cursor.tokens[index];
}

function advanceToken(cursor) {
    if (!isCurrentToken(cursor, "eof")) {
        cursor.index += 1;
    }

    return previousToken(cursor);
}

function previousToken(cursor) {
    return cursor.tokens[cursor.index - 1];
}

function matchToken(cursor, kind) {
    if (!isCurrentToken(cursor, kind)) {
        return false;
    }

    advanceToken(cursor);
    return true;
}

function isCurrentToken(cursor, kind) {
    return currentToken(cursor).kind === kind;
}

function isCurrentTokenAt(cursor, offset, kind) {
    return peekToken(cursor, offset).kind === kind;
}

function isCurrentIdentifier(cursor, text) {
    let token = currentToken(cursor);

    return token.kind === "identifier" && token.text === text;
}

function tokenStartsStatement(cursor, offset) {
    return tokenStartsLetStatement(cursor, offset)
        || (peekToken(cursor, offset).kind === "identifier" && peekToken(cursor, offset + 1).kind === "left_paren");
}

function isMacroDeclarationStart(cursor) {
    let depth = 0;
    let index = cursor.index;
    let token = null;

    if (peekToken(cursor, 0).kind !== "identifier" || peekToken(cursor, 1).kind !== "left_paren") {
        return false;
    }

    index += 1;

    while (index < cursor.tokens.length) {
        token = cursor.tokens[index];

        if (token.kind === "left_paren") {
            depth += 1;
        }

        if (token.kind === "right_paren") {
            depth -= 1;

            if (depth === 0) {
                if (index + 1 < cursor.tokens.length) {
                    return cursor.tokens[index + 1].kind === "equal";
                }

                return false;
            }
        }

        if (token.kind === "eof") {
            return false;
        }

        index += 1;
    }

    return false;
}

function tokenStartsLetStatement(cursor, offset) {
    return peekToken(cursor, offset).kind === "identifier"
        && peekToken(cursor, offset).text === "let"
        && peekToken(cursor, offset + 1).kind === "identifier"
        && (peekToken(cursor, offset + 2).kind === "equal" || peekToken(cursor, offset + 2).kind === "left_paren");
}

function tokenStartsLetAssignment(cursor, offset) {
    return peekToken(cursor, offset).kind === "identifier"
        && peekToken(cursor, offset).text === "let"
        && peekToken(cursor, offset + 1).kind === "identifier"
        && peekToken(cursor, offset + 2).kind === "equal";
}

function matchIdentifier(cursor, text) {
    if (!isCurrentIdentifier(cursor, text)) {
        return false;
    }

    advanceToken(cursor);
    return true;
}

function punctuationKind(ch) {
    switch (ch) {
        case "=":
            return "equal";
        case "(":
            return "left_paren";
        case ")":
            return "right_paren";
        case ",":
            return "comma";
        case "[":
            return "left_bracket";
        case "]":
            return "right_bracket";
        case "{":
            return "left_brace";
        case "}":
            return "right_brace";
    }

    return "";
}

function isIdentifierStart(ch) {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isIdentifierPart(ch) {
    return isIdentifierStart(ch) || isDigit(ch);
}

function isNumberStart(source, index) {
    let ch = source.charAt(index);
    let next = source.charAt(index + 1);

    return isDigit(ch)
        || (ch === "." && isDigit(next))
        || ((ch === "-" || ch === "+") && (isDigit(next) || next === "."));
}

function isDigit(ch) {
    return ch >= "0" && ch <= "9";
}

export function compileScene(parsed) {
    let result = {
        ok: false,
        source: "",
        errors: [],
        primitiveCount: 0
    };
    let context = {
        parsed: parsed,
        errors: [],
        primitiveCount: 0,
        scopes: [],
        macroStack: [],
        nextScopeId: 1
    };
    let stack = [];
    let expression = "";
    let sampleExpression = "";
    let primitiveCount = 0;

    if (!parsed) {
        result.errors.push("No parsed script was provided.");
        return result;
    }

    if (!parsed.ok) {
        copyErrors(result.errors, parsed.errors);
        return result;
    }

    if (!parsed.rootExpr) {
        result.errors.push("No render expression was found.");
        return result;
    }

    stack.push("root");
    expression = compileExprGlsl(parsed.rootExpr, context, stack, "p");
    primitiveCount = context.primitiveCount;

    if (context.errors.length > 0) {
        copyErrors(result.errors, context.errors);
        return result;
    }

    stack.length = 0;
    stack.push("root");
    sampleExpression = compileExprSampleGlsl(parsed.rootExpr, context, stack, "p");

    if (context.errors.length > 0) {
        copyErrors(result.errors, context.errors);
        return result;
    }

    result.ok = true;
    result.primitiveCount = primitiveCount;
    result.source = [
        "struct SdfSample {",
        "    float d;",
        "    vec3 color;",
        "};",
        "const vec3 SDF_DEFAULT_COLOR = vec3(0.45, 0.26, 0.025);",
        "SdfSample make_sdf_sample(float d, vec3 color) {",
        "    return SdfSample(d, clamp(color, vec3(0.0), vec3(1.0)));",
        "}",
        "SdfSample sdf_default_sample(float d) {",
        "    return make_sdf_sample(d, SDF_DEFAULT_COLOR);",
        "}",
        "SdfSample sdf_color_sample(SdfSample sample_value, vec3 color) {",
        "    sample_value.color = clamp(color, vec3(0.0), vec3(1.0));",
        "    return sample_value;",
        "}",
        "SdfSample sdf_union_sample(SdfSample a, SdfSample b) {",
        "    if (b.d < a.d) {",
        "        return b;",
        "    }",
        "    return a;",
        "}",
        "SdfSample sdf_intersect_sample(SdfSample a, SdfSample b) {",
        "    if (b.d > a.d) {",
        "        return b;",
        "    }",
        "    return a;",
        "}",
        "SdfSample sdf_subtract_sample(SdfSample a, SdfSample b) {",
        "    return make_sdf_sample(max(a.d, -b.d), a.color);",
        "}",
        "SdfSample sdf_smooth_union_sample(SdfSample a, SdfSample b, float radius) {",
        "    float k = max(radius, 0.0001);",
        "    float t = clamp(0.5 + 0.5 * (a.d - b.d) / k, 0.0, 1.0);",
        "    return make_sdf_sample(op_smooth_union(a.d, b.d, radius), mix(a.color, b.color, t));",
        "}",
        "SdfSample sdf_smooth_intersect_sample(SdfSample a, SdfSample b, float radius) {",
        "    float k = max(radius, 0.0001);",
        "    float t = clamp(0.5 + 0.5 * (b.d - a.d) / k, 0.0, 1.0);",
        "    return make_sdf_sample(-op_smooth_union(-a.d, -b.d, radius), mix(a.color, b.color, t));",
        "}",
        "SdfSample sdf_smooth_subtract_sample(SdfSample a, SdfSample b, float radius) {",
        "    return make_sdf_sample(-op_smooth_union(-a.d, b.d, radius), a.color);",
        "}",
        "SdfSample sdf_chamfer_union_sample(SdfSample a, SdfSample b, float radius) {",
        "    float plane = (a.d + b.d - radius) * 0.70710678118;",
        "    float d = min(min(a.d, b.d), plane);",
        "    float t = clamp(0.5 + 0.5 * (a.d - b.d) / max(radius, 0.0001), 0.0, 1.0);",
        "    vec3 color = a.color;",
        "    if (b.d < a.d) {",
        "        color = b.color;",
        "    }",
        "    if (plane <= min(a.d, b.d)) {",
        "        color = mix(a.color, b.color, t);",
        "    }",
        "    return make_sdf_sample(d, color);",
        "}",
        "SdfSample sdf_chamfer_intersect_sample(SdfSample a, SdfSample b, float radius) {",
        "    float plane = (a.d + b.d + radius) * 0.70710678118;",
        "    float d = max(max(a.d, b.d), plane);",
        "    float t = clamp(0.5 + 0.5 * (b.d - a.d) / max(radius, 0.0001), 0.0, 1.0);",
        "    vec3 color = a.color;",
        "    if (b.d > a.d) {",
        "        color = b.color;",
        "    }",
        "    if (plane >= max(a.d, b.d)) {",
        "        color = mix(a.color, b.color, t);",
        "    }",
        "    return make_sdf_sample(d, color);",
        "}",
        "SdfSample sdf_chamfer_subtract_sample(SdfSample a, SdfSample b, float radius) {",
        "    return make_sdf_sample(op_chamfer_subtract(a.d, b.d, radius), a.color);",
        "}",
        "SdfSample sdf_offset_sample(SdfSample sample_value, float amount) {",
        "    sample_value.d -= amount;",
        "    return sample_value;",
        "}",
        "SdfSample sdf_shell_sample(SdfSample sample_value, float thickness) {",
        "    sample_value.d = abs(sample_value.d) - thickness;",
        "    return sample_value;",
        "}",
        "SdfSample sdf_scale_sample(SdfSample sample_value, float scale_value) {",
        "    sample_value.d *= scale_value;",
        "    return sample_value;",
        "}",
        "float scene_sdf(vec3 p) {",
        "    float object_sdf = " + expression + ";",
        "    float bounds_size = max(u_bounds_size, 0.0);",
        "    float bounds_sdf = -p.z;",
        "    if (bounds_size > 0.0) {",
        "        bounds_sdf = sd_box(p - vec3(0.0, 0.0, bounds_size * 0.5), vec3(bounds_size * 0.5));",
        "    }",
        "    return max(object_sdf, bounds_sdf);",
        "}",
        "SdfSample scene_sample(vec3 p) {",
        "    SdfSample object_sample = " + sampleExpression + ";",
        "    float bounds_size = max(u_bounds_size, 0.0);",
        "    float bounds_sdf = -p.z;",
        "    if (bounds_size > 0.0) {",
        "        bounds_sdf = sd_box(p - vec3(0.0, 0.0, bounds_size * 0.5), vec3(bounds_size * 0.5));",
        "    }",
        "    object_sample.d = max(object_sample.d, bounds_sdf);",
        "    return object_sample;",
        "}"
    ].join("\n");

    return result;
}

function compileExprGlsl(expr, context, stack, pText) {
    let callName = "";

    if (expr.kind === "number") {
        return formatNumber(expr.value);
    }

    if (expr.kind === "list" || expr.kind === "for_range" || expr.kind === "for_each") {
        context.errors.push("List value cannot be used as a shape.");
        return "1000000.0";
    }

    if (expr.kind === "captured") {
        return compileCapturedWrapperGlsl(expr, context, stack, pText);
    }

    if (expr.kind === "spread") {
        context.errors.push("Spread arguments are only allowed inside function calls.");
        return "1000000.0";
    }

    if (expr.kind === "block") {
        return compileBlockGlsl(expr, context, stack, pText);
    }

    if (expr.kind === "name") {
        return compileNameGlsl(expr.name, context, stack, pText);
    }

    if (expr.kind !== "call") {
        context.errors.push("Unsupported expression.");
        return "1000000.0";
    }

    expr = expandCallExpr(expr, context, stack);
    callName = expr.name.toLowerCase();

    switch (callName) {
        case "sphere":
            return compileSphereGlsl(expr, context, pText);
        case "box":
            return compileBoxGlsl(expr, context, pText);
        case "rounded_box":
            return compileRoundedBoxGlsl(expr, context, pText);
        case "box_frame":
            return compileBoxFrameGlsl(expr, context, pText);
        case "chamfer_box":
            return compileChamferBoxGlsl(expr, context, pText);
        case "cylinder":
            return compileCylinderGlsl(expr, context, pText);
        case "rounded_cylinder":
            return compileRoundedCylinderGlsl(expr, context, pText);
        case "chamfer_cylinder":
            return compileChamferCylinderGlsl(expr, context, pText);
        case "tri_prism":
            return compileTriPrismGlsl(expr, context, pText);
        case "hex_prism":
            return compileHexPrismGlsl(expr, context, pText);
        case "octagon_prism":
            return compileOctagonPrismGlsl(expr, context, pText);
        case "cone":
            return compileConeGlsl(expr, context, pText);
        case "rounded_cone":
            return compileRoundedConeGlsl(expr, context, pText);
        case "chamfer_cone":
            return compileChamferConeGlsl(expr, context, pText);
        case "pyramid":
            return compilePyramidGlsl(expr, context, pText);
        case "octahedron":
            return compileOctahedronGlsl(expr, context, pText);
        case "torus":
            return compileTorusGlsl(expr, context, pText);
        case "capped_torus":
            return compileCappedTorusGlsl(expr, context, pText);
        case "capped_cylinder":
        case "capped_line":
            return compileCappedCylinderGlsl(expr, context, pText);
        case "capped_cone":
            return compileCappedConeGlsl(expr, context, pText);
        case "union":
            return compileUnionGlsl(expr, context, stack, pText);
        case "intersect":
            return compileIntersectGlsl(expr, context, stack, pText);
        case "subtract":
            return compileSubtractGlsl(expr, context, stack, pText);
        case "smooth_union":
            return compileSmoothCsgGlsl(expr, context, stack, pText, "union");
        case "smooth_intersect":
            return compileSmoothCsgGlsl(expr, context, stack, pText, "intersect");
        case "smooth_subtract":
            return compileSmoothCsgGlsl(expr, context, stack, pText, "subtract");
        case "chamfer_union":
            return compileChamferCsgGlsl(expr, context, stack, pText, "union");
        case "chamfer_intersect":
            return compileChamferCsgGlsl(expr, context, stack, pText, "intersect");
        case "chamfer_subtract":
            return compileChamferCsgGlsl(expr, context, stack, pText, "subtract");
        case "color":
            return compileColorGlsl(expr, context, stack, pText);
        case "move":
            return compileMoveGlsl(expr, context, stack, pText);
        case "scale":
            return compileScaleGlsl(expr, context, stack, pText);
        case "rotate":
            return compileRotateGlsl(expr, context, stack, pText);
        case "round":
            return compileRoundGlsl(expr, context, stack, pText);
        case "shell":
            return compileShellGlsl(expr, context, stack, pText);
    }

    if (isPrimitiveOperationName(callName)) {
        return compilePrimitiveOperationGlsl(expr, context, stack, pText, callName);
    }

    if (findMacroIndex(context.parsed, expr.name) >= 0) {
        return compileMacroCallGlsl(expr, context, stack, pText);
    }

    context.errors.push("Unknown function '" + expr.name + "'.");
    return "1000000.0";
}

function compileExprSampleGlsl(expr, context, stack, pText) {
    let callName = "";

    if (expr.kind === "number") {
        return "sdf_default_sample(" + formatNumber(expr.value) + ")";
    }

    if (expr.kind === "list" || expr.kind === "for_range" || expr.kind === "for_each") {
        context.errors.push("List value cannot be used as a shape.");
        return "sdf_default_sample(1000000.0)";
    }

    if (expr.kind === "captured") {
        return compileCapturedWrapperSampleGlsl(expr, context, stack, pText);
    }

    if (expr.kind === "spread") {
        context.errors.push("Spread arguments are only allowed inside function calls.");
        return "sdf_default_sample(1000000.0)";
    }

    if (expr.kind === "block") {
        return compileBlockSampleGlsl(expr, context, stack, pText);
    }

    if (expr.kind === "name") {
        return compileNameSampleGlsl(expr.name, context, stack, pText);
    }

    if (expr.kind !== "call") {
        context.errors.push("Unsupported expression.");
        return "sdf_default_sample(1000000.0)";
    }

    expr = expandCallExpr(expr, context, stack);
    callName = expr.name.toLowerCase();

    switch (callName) {
        case "union":
            return compileCsgSampleGlsl(expr, context, stack, pText, "union");
        case "intersect":
            return compileCsgSampleGlsl(expr, context, stack, pText, "intersect");
        case "subtract":
            return compileCsgSampleGlsl(expr, context, stack, pText, "subtract");
        case "smooth_union":
            return compileSmoothCsgSampleGlsl(expr, context, stack, pText, "union");
        case "smooth_intersect":
            return compileSmoothCsgSampleGlsl(expr, context, stack, pText, "intersect");
        case "smooth_subtract":
            return compileSmoothCsgSampleGlsl(expr, context, stack, pText, "subtract");
        case "chamfer_union":
            return compileChamferCsgSampleGlsl(expr, context, stack, pText, "union");
        case "chamfer_intersect":
            return compileChamferCsgSampleGlsl(expr, context, stack, pText, "intersect");
        case "chamfer_subtract":
            return compileChamferCsgSampleGlsl(expr, context, stack, pText, "subtract");
        case "color":
            return compileColorSampleGlsl(expr, context, stack, pText);
        case "move":
            return compileMoveSampleGlsl(expr, context, stack, pText);
        case "scale":
            return compileScaleSampleGlsl(expr, context, stack, pText);
        case "rotate":
            return compileRotateSampleGlsl(expr, context, stack, pText);
        case "round":
            return compileRoundSampleGlsl(expr, context, stack, pText);
        case "shell":
            return compileShellSampleGlsl(expr, context, stack, pText);
        case "min":
            return compileCsgSampleGlsl(expr, context, stack, pText, "union");
        case "max":
            return compileCsgSampleGlsl(expr, context, stack, pText, "intersect");
        default:
            if (isShapePrimitiveCallName(callName)) {
                return "sdf_default_sample(" + compileExprGlsl(expr, context, stack, pText) + ")";
            }
    }

    if (isPrimitiveOperationName(callName)) {
        return "sdf_default_sample(" + compilePrimitiveOperationGlsl(expr, context, stack, pText, callName) + ")";
    }

    if (findMacroIndex(context.parsed, expr.name) >= 0) {
        return compileMacroCallSampleGlsl(expr, context, stack, pText);
    }

    context.errors.push("Unknown function '" + expr.name + "'.");
    return "sdf_default_sample(1000000.0)";
}

function compileNameGlsl(name, context, stack, pText) {
    let reference = findScopedAssignment(context, name);
    let stackIndex = 0;
    let expression = "";

    if (!reference.found) {
        context.errors.push("Unknown shape name '" + name + "'.");
        return "1000000.0";
    }

    for (stackIndex = 0; stackIndex < stack.length; stackIndex += 1) {
        if (stack[stackIndex] === reference.key) {
            context.errors.push("Cyclic shape reference involving '" + name + "'.");
            return "1000000.0";
        }
    }

    stack.push(reference.key);
    expression = compileCapturedExprGlsl(reference, context, stack, pText);
    stack.pop();

    return expression;
}

function compileCapturedExprGlsl(reference, context, stack, pText) {
    let expression = "";
    let savedScopes = null;

    if (!reference.capturedScopes) {
        return compileExprGlsl(reference.expr, context, stack, pText);
    }

    savedScopes = context.scopes;
    context.scopes = reference.capturedScopes;
    expression = compileExprGlsl(reference.expr, context, stack, pText);
    context.scopes = savedScopes;

    return expression;
}

function compileBlockGlsl(expr, context, stack, pText) {
    let resultIndex = blockResultIndex(expr);
    let scopeId = -1;
    let expression = "";

    if (resultIndex < 0) {
        context.errors.push("Block expression must end with a result expression.");
        return "1000000.0";
    }

    scopeId = pushCompilerScope(context, expr);
    stack.push("s:" + scopeId + ":" + resultIndex);
    expression = compileExprGlsl(expr.exprs[resultIndex], context, stack, pText);
    stack.pop();
    context.scopes.pop();

    return expression;
}

function compileMacroCallGlsl(expr, context, stack, pText) {
    let macro = findMacro(context.parsed, expr.name);
    let macroIndex = 0;
    let expression = "";
    let scope = null;

    if (!macro) {
        context.errors.push("Unknown function '" + expr.name + "'.");
        return "1000000.0";
    }

    if (expr.args.length !== macro.params.length) {
        context.errors.push(
            "Macro '" + expr.name + "' expected "
            + macro.params.length + " arguments but received "
            + expr.args.length + "."
        );
        return "1000000.0";
    }

    for (macroIndex = 0; macroIndex < context.macroStack.length; macroIndex += 1) {
        if (context.macroStack[macroIndex] === macro.name) {
            context.errors.push("Recursive macro call involving '" + macro.name + "'.");
            return "1000000.0";
        }
    }

    scope = {
        names: macro.params,
        exprs: expr.args,
        capturedScopes: context.scopes.slice()
    };

    context.macroStack.push(macro.name);
    pushCompilerScope(context, scope);
    expression = compileExprGlsl(macro.body, context, stack, pText);
    context.scopes.pop();
    context.macroStack.pop();

    return expression;
}

function compileNameSampleGlsl(name, context, stack, pText) {
    let reference = findScopedAssignment(context, name);
    let stackIndex = 0;
    let expression = "";

    if (!reference.found) {
        context.errors.push("Unknown shape name '" + name + "'.");
        return "sdf_default_sample(1000000.0)";
    }

    for (stackIndex = 0; stackIndex < stack.length; stackIndex += 1) {
        if (stack[stackIndex] === reference.key) {
            context.errors.push("Cyclic shape reference involving '" + name + "'.");
            return "sdf_default_sample(1000000.0)";
        }
    }

    stack.push(reference.key);
    expression = compileCapturedExprSampleGlsl(reference, context, stack, pText);
    stack.pop();

    return expression;
}

function compileCapturedExprSampleGlsl(reference, context, stack, pText) {
    let expression = "";
    let savedScopes = null;

    if (!reference.capturedScopes) {
        return compileExprSampleGlsl(reference.expr, context, stack, pText);
    }

    savedScopes = context.scopes;
    context.scopes = reference.capturedScopes;
    expression = compileExprSampleGlsl(reference.expr, context, stack, pText);
    context.scopes = savedScopes;

    return expression;
}

function compileBlockSampleGlsl(expr, context, stack, pText) {
    let resultIndex = blockResultIndex(expr);
    let scopeId = -1;
    let expression = "";

    if (resultIndex < 0) {
        context.errors.push("Block expression must end with a result expression.");
        return "sdf_default_sample(1000000.0)";
    }

    scopeId = pushCompilerScope(context, expr);
    stack.push("s:" + scopeId + ":" + resultIndex);
    expression = compileExprSampleGlsl(expr.exprs[resultIndex], context, stack, pText);
    stack.pop();
    context.scopes.pop();

    return expression;
}

function compileMacroCallSampleGlsl(expr, context, stack, pText) {
    let macro = findMacro(context.parsed, expr.name);
    let macroIndex = 0;
    let expression = "";
    let scope = null;

    if (!macro) {
        context.errors.push("Unknown function '" + expr.name + "'.");
        return "sdf_default_sample(1000000.0)";
    }

    if (expr.args.length !== macro.params.length) {
        context.errors.push(
            "Macro '" + expr.name + "' expected "
            + macro.params.length + " arguments but received "
            + expr.args.length + "."
        );
        return "sdf_default_sample(1000000.0)";
    }

    for (macroIndex = 0; macroIndex < context.macroStack.length; macroIndex += 1) {
        if (context.macroStack[macroIndex] === macro.name) {
            context.errors.push("Recursive macro call involving '" + macro.name + "'.");
            return "sdf_default_sample(1000000.0)";
        }
    }

    scope = {
        names: macro.params,
        exprs: expr.args,
        capturedScopes: context.scopes.slice()
    };

    context.macroStack.push(macro.name);
    pushCompilerScope(context, scope);
    expression = compileExprSampleGlsl(macro.body, context, stack, pText);
    context.scopes.pop();
    context.macroStack.pop();

    return expression;
}

function compileCapturedWrapperGlsl(expr, context, stack, pText) {
    let savedScopes = context.scopes;
    let expression = "";

    context.scopes = expr.capturedScopes;
    expression = compileExprGlsl(expr.expr, context, stack, pText);
    context.scopes = savedScopes;

    return expression;
}

function compileCapturedWrapperSampleGlsl(expr, context, stack, pText) {
    let savedScopes = context.scopes;
    let expression = "";

    context.scopes = expr.capturedScopes;
    expression = compileExprSampleGlsl(expr.expr, context, stack, pText);
    context.scopes = savedScopes;

    return expression;
}

function expandCallExpr(expr, context, stack) {
    let expandedArgs = [];
    let index = 0;
    let list = null;
    let itemIndex = 0;
    let changed = false;

    for (index = 0; index < expr.args.length; index += 1) {
        if (expr.args[index].kind === "spread") {
            changed = true;
            list = resolveListValue(expr.args[index].expr, context, stack);

            if (!list.ok) {
                context.errors.push("Spread argument to '" + expr.name + "' must be a list.");
            } else {
                for (itemIndex = 0; itemIndex < list.value.length; itemIndex += 1) {
                    expandedArgs.push(list.value[itemIndex]);
                }
            }
        } else {
            expandedArgs.push(expr.args[index]);
        }
    }

    if (!changed) {
        return expr;
    }

    return {
        kind: "call",
        name: expr.name,
        args: expandedArgs
    };
}

function resolveListValue(expr, context, stack) {
    let reference = null;
    let resultIndex = -1;
    let scopeId = -1;
    let result = null;
    let macro = null;

    if (!expr) {
        return emptyListResult(false);
    }

    if (expr.kind === "list") {
        return limitListResult(context, expr.args.slice());
    }

    if (expr.kind === "captured") {
        return resolveCapturedWrapperListValue(expr, context, stack);
    }

    if (expr.kind === "for_range") {
        return resolveForRangeListValue(expr, context, stack);
    }

    if (expr.kind === "for_each") {
        return resolveForEachListValue(expr, context, stack);
    }

    if (expr.kind === "name") {
        reference = findScopedAssignment(context, expr.name);

        if (!reference.found || stackContains(stack, reference.key)) {
            return emptyListResult(false);
        }

        stack.push(reference.key);
        result = resolveCapturedListValue(reference, context, stack);
        stack.pop();

        return result;
    }

    if (expr.kind === "block") {
        resultIndex = blockResultIndex(expr);

        if (resultIndex < 0) {
            return emptyListResult(false);
        }

        scopeId = pushCompilerScope(context, expr);
        stack.push("s:" + scopeId + ":" + resultIndex);
        result = resolveListValue(expr.exprs[resultIndex], context, stack);
        stack.pop();
        context.scopes.pop();

        return result;
    }

    if (expr.kind === "call") {
        expr = expandCallExpr(expr, context, stack);
        macro = findMacro(context.parsed, expr.name);

        if (macro) {
            return resolveMacroListValue(expr, context, stack, macro);
        }
    }

    return emptyListResult(false);
}

function resolveForRangeListValue(expr, context, stack) {
    let start = resolveNumberValue(expr.start, context, stack);
    let end = resolveNumberValue(expr.end, context, stack);
    let step = resolveNumberValue(expr.step, context, stack);
    let items = [];
    let current = 0.0;
    let scope = null;

    if (!start.ok || !end.ok || !step.ok) {
        return emptyListResult(false);
    }

    if (step.value === 0.0) {
        context.errors.push("For loop step must not be zero.");
        return emptyListResult(false);
    }

    current = start.value;

    while (rangeIncludesValue(current, end.value, step.value)) {
        if (items.length >= LIST_EXPANSION_LIMIT) {
            context.errors.push("List expansion exceeded " + LIST_EXPANSION_LIMIT + " items.");
            return emptyListResult(false);
        }

        scope = detachedCompilerScope(context, [expr.name], [{ kind: "number", value: current }]);
        items.push(capturedExpr(expr.body, context.scopes.concat([scope])));
        current += step.value;
    }

    return {
        ok: true,
        value: items
    };
}

function resolveForEachListValue(expr, context, stack) {
    let list = resolveListValue(expr.list, context, stack);
    let items = [];
    let index = 0;
    let scope = null;

    if (!list.ok) {
        return emptyListResult(false);
    }

    for (index = 0; index < list.value.length; index += 1) {
        if (items.length >= LIST_EXPANSION_LIMIT) {
            context.errors.push("List expansion exceeded " + LIST_EXPANSION_LIMIT + " items.");
            return emptyListResult(false);
        }

        scope = detachedCompilerScope(context, [expr.name], [list.value[index]]);
        items.push(capturedExpr(expr.body, context.scopes.concat([scope])));
    }

    return {
        ok: true,
        value: items
    };
}

function resolveMacroListValue(expr, context, stack, macro) {
    let macroIndex = 0;
    let result = null;
    let scope = null;

    if (expr.args.length !== macro.params.length) {
        context.errors.push(
            "Macro '" + expr.name + "' expected "
            + macro.params.length + " arguments but received "
            + expr.args.length + "."
        );

        return emptyListResult(false);
    }

    for (macroIndex = 0; macroIndex < context.macroStack.length; macroIndex += 1) {
        if (context.macroStack[macroIndex] === macro.name) {
            context.errors.push("Recursive macro call involving '" + macro.name + "'.");
            return emptyListResult(false);
        }
    }

    scope = {
        names: macro.params,
        exprs: expr.args,
        capturedScopes: context.scopes.slice()
    };

    context.macroStack.push(macro.name);
    pushCompilerScope(context, scope);
    result = resolveListValue(macro.body, context, stack);
    context.scopes.pop();
    context.macroStack.pop();

    return result;
}

function resolveCapturedListValue(reference, context, stack) {
    let result = null;
    let savedScopes = null;

    if (!reference.capturedScopes) {
        return resolveListValue(reference.expr, context, stack);
    }

    savedScopes = context.scopes;
    context.scopes = reference.capturedScopes;
    result = resolveListValue(reference.expr, context, stack);
    context.scopes = savedScopes;

    return result;
}

function resolveCapturedWrapperListValue(expr, context, stack) {
    let result = null;
    let savedScopes = context.scopes;

    context.scopes = expr.capturedScopes;
    result = resolveListValue(expr.expr, context, stack);
    context.scopes = savedScopes;

    return result;
}

function detachedCompilerScope(context, names, exprs) {
    let scope = {
        names: names,
        exprs: exprs
    };

    scope.scopeId = context.nextScopeId;
    context.nextScopeId += 1;

    return scope;
}

function capturedExpr(expr, capturedScopes) {
    return {
        kind: "captured",
        expr: expr,
        capturedScopes: capturedScopes
    };
}

function emptyListResult(ok) {
    return {
        ok: ok,
        value: []
    };
}

function limitListResult(context, items) {
    if (items.length > LIST_EXPANSION_LIMIT) {
        context.errors.push("List expansion exceeded " + LIST_EXPANSION_LIMIT + " items.");
        return emptyListResult(false);
    }

    return {
        ok: true,
        value: items
    };
}

function rangeIncludesValue(value, end, step) {
    if (step > 0.0) {
        return value <= end + 0.000000001;
    }

    return value >= end - 0.000000001;
}

function compileColorGlsl(expr, context, stack, pText) {
    if (!requireArgCount(expr, context, 2)) {
        return "1000000.0";
    }

    vectorArgValue(expr, context, 1);

    return compileExprGlsl(expr.args[0], context, stack, pText);
}

function compileColorSampleGlsl(expr, context, stack, pText) {
    let expression = "";
    let color = "";

    if (!requireArgCount(expr, context, 2)) {
        return "sdf_default_sample(1000000.0)";
    }

    expression = compileExprSampleGlsl(expr.args[0], context, stack, pText);
    color = vectorArgText(expr, context, 1);

    return "sdf_color_sample(" + expression + ", " + color + ")";
}

function compileSphereGlsl(expr, context, pText) {
    if (!requireArgCount(expr, context, 2)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;

    return "sd_sphere(" + pText + " - "
        + vectorArgText(expr, context, 0) + ", "
        + numberArgText(expr, context, 1) + ")";
}

function compileBoxGlsl(expr, context, pText) {
    if (!requireArgCount(expr, context, 2)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;

    return "sd_box(" + pText + " - "
        + vectorArgText(expr, context, 0) + ", "
        + halfBoxSizeArgText(expr, context, 1) + ")";
}

function compileRoundedBoxGlsl(expr, context, pText) {
    if (!requireArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;

    return "sd_rounded_box(" + pText + " - "
        + vectorArgText(expr, context, 0) + ", "
        + halfBoxSizeArgText(expr, context, 1) + ", "
        + numberArgText(expr, context, 2) + ")";
}

function compileBoxFrameGlsl(expr, context, pText) {
    if (!requireArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;

    return "sd_box_frame(" + pText + " - "
        + vectorArgText(expr, context, 0) + ", "
        + halfBoxSizeArgText(expr, context, 1) + ", "
        + numberArgText(expr, context, 2) + ")";
}

function compileChamferBoxGlsl(expr, context, pText) {
    if (!requireArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;

    return "sd_chamfer_box(" + pText + " - "
        + vectorArgText(expr, context, 0) + ", "
        + halfVectorArgText(expr, context, 1) + ", "
        + numberArgText(expr, context, 2) + ")";
}

function compileCylinderGlsl(expr, context, pText) {
    if (!requireArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;

    return "sd_cylinder(" + pText + " - "
        + vectorArgText(expr, context, 0) + ", "
        + numberArgText(expr, context, 1) + ", "
        + halfNumberArgText(expr, context, 2) + ")";
}

function compileRoundedCylinderGlsl(expr, context, pText) {
    if (!requireArgCount(expr, context, 4)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;

    return "sd_rounded_cylinder(" + pText + " - "
        + vectorArgText(expr, context, 0) + ", "
        + numberArgText(expr, context, 1) + ", "
        + halfNumberArgText(expr, context, 2) + ", "
        + numberArgText(expr, context, 3) + ")";
}

function compileChamferCylinderGlsl(expr, context, pText) {
    if (!requireArgCount(expr, context, 4)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;

    return "sd_chamfer_cylinder(" + pText + " - "
        + vectorArgText(expr, context, 0) + ", "
        + numberArgText(expr, context, 1) + ", "
        + halfNumberArgText(expr, context, 2) + ", "
        + numberArgText(expr, context, 3) + ")";
}

function compileTriPrismGlsl(expr, context, pText) {
    if (!requireArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;

    return "sd_tri_prism(" + pText + " - "
        + vectorArgText(expr, context, 0) + ", "
        + numberArgText(expr, context, 1) + ", "
        + halfNumberArgText(expr, context, 2) + ")";
}

function compileHexPrismGlsl(expr, context, pText) {
    if (!requireArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;

    return "sd_hex_prism(" + pText + " - "
        + vectorArgText(expr, context, 0) + ", "
        + numberArgText(expr, context, 1) + ", "
        + halfNumberArgText(expr, context, 2) + ")";
}

function compileOctagonPrismGlsl(expr, context, pText) {
    if (!requireArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;

    return "sd_octagon_prism(" + pText + " - "
        + vectorArgText(expr, context, 0) + ", "
        + numberArgText(expr, context, 1) + ", "
        + halfNumberArgText(expr, context, 2) + ")";
}

function compileConeGlsl(expr, context, pText) {
    if (!requireArgCount(expr, context, 4)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;

    return "sd_cone(" + pText + " - "
        + vectorArgText(expr, context, 0) + ", "
        + numberArgText(expr, context, 1) + ", "
        + numberArgText(expr, context, 2) + ", "
        + numberArgText(expr, context, 3) + ")";
}

function compileRoundedConeGlsl(expr, context, pText) {
    if (!requireArgCount(expr, context, 5)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;

    return "sd_rounded_cone(" + pText + " - "
        + vectorArgText(expr, context, 0) + ", "
        + numberArgText(expr, context, 1) + ", "
        + numberArgText(expr, context, 2) + ", "
        + numberArgText(expr, context, 3) + ", "
        + numberArgText(expr, context, 4) + ")";
}

function compileChamferConeGlsl(expr, context, pText) {
    if (!requireArgCount(expr, context, 5)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;

    return "sd_chamfer_cone(" + pText + " - "
        + vectorArgText(expr, context, 0) + ", "
        + numberArgText(expr, context, 1) + ", "
        + numberArgText(expr, context, 2) + ", "
        + numberArgText(expr, context, 3) + ", "
        + numberArgText(expr, context, 4) + ")";
}

function compilePyramidGlsl(expr, context, pText) {
    if (!requireArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;

    return "sd_pyramid(" + pText + " - "
        + vectorArgText(expr, context, 0) + ", "
        + numberArgText(expr, context, 1) + ", "
        + numberArgText(expr, context, 2) + ")";
}

function compileOctahedronGlsl(expr, context, pText) {
    if (!requireArgCount(expr, context, 2)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;

    return "sd_octahedron(" + pText + " - "
        + vectorArgText(expr, context, 0) + ", "
        + numberArgText(expr, context, 1) + ")";
}

function compileTorusGlsl(expr, context, pText) {
    if (!requireArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;

    return "sd_torus(" + pText + " - "
        + vectorArgText(expr, context, 0) + ", "
        + numberArgText(expr, context, 1) + ", "
        + numberArgText(expr, context, 2) + ")";
}

function compileCappedTorusGlsl(expr, context, pText) {
    if (!requireArgCount(expr, context, 5)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;

    return "sd_capped_torus(" + pText + " - "
        + vectorArgText(expr, context, 0) + ", "
        + numberArgText(expr, context, 1) + ", "
        + numberArgText(expr, context, 2) + ", "
        + numberArgText(expr, context, 3) + ", "
        + numberArgText(expr, context, 4) + ")";
}

function compileCappedCylinderGlsl(expr, context, pText) {
    if (!requireArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;

    return "sd_capped_cylinder(" + pText + ", "
        + vectorArgText(expr, context, 0) + ", "
        + vectorArgText(expr, context, 1) + ", "
        + numberArgText(expr, context, 2) + ")";
}

function compileCappedConeGlsl(expr, context, pText) {
    if (!requireArgCount(expr, context, 4)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;

    return "sd_capped_cone(" + pText + ", "
        + vectorArgText(expr, context, 0) + ", "
        + vectorArgText(expr, context, 1) + ", "
        + numberArgText(expr, context, 2) + ", "
        + numberArgText(expr, context, 3) + ")";
}

function compileUnionGlsl(expr, context, stack, pText) {
    return compileCsgGlsl(expr, context, stack, pText, "union");
}

function compileIntersectGlsl(expr, context, stack, pText) {
    return compileCsgGlsl(expr, context, stack, pText, "intersect");
}

function compileSubtractGlsl(expr, context, stack, pText) {
    return compileCsgGlsl(expr, context, stack, pText, "subtract");
}

function compileCsgGlsl(expr, context, stack, pText, operation) {
    let args = [];
    let index = 0;
    let expression = "";

    if (!requireMinimumArgCount(expr, context, 2)) {
        return "1000000.0";
    }

    for (index = 0; index < expr.args.length; index += 1) {
        args.push(compileExprGlsl(expr.args[index], context, stack, pText));
    }

    expression = args[0];

    for (index = 1; index < args.length; index += 1) {
        if (operation === "union") {
            expression = "min(" + expression + ", " + args[index] + ")";
        }

        if (operation === "intersect") {
            expression = "max(" + expression + ", " + args[index] + ")";
        }

        if (operation === "subtract") {
            expression = "max(" + expression + ", " + negateGlsl(args[index]) + ")";
        }
    }

    return expression;
}

function compileSmoothCsgGlsl(expr, context, stack, pText, operation) {
    let radiusIndex = expr.args.length - 1;
    let radius = "";
    let expression = "";
    let nextExpression = "";
    let index = 0;

    if (!requireMinimumArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    radius = numberArgText(expr, context, radiusIndex);
    expression = compileExprGlsl(expr.args[0], context, stack, pText);

    for (index = 1; index < radiusIndex; index += 1) {
        nextExpression = compileExprGlsl(expr.args[index], context, stack, pText);

        if (operation === "union") {
            expression = "op_smooth_union(" + expression + ", " + nextExpression + ", " + radius + ")";
        }

        if (operation === "intersect") {
            expression = negateGlsl("op_smooth_union(" + negateGlsl(expression) + ", " + negateGlsl(nextExpression) + ", " + radius + ")");
        }

        if (operation === "subtract") {
            expression = negateGlsl("op_smooth_union(" + negateGlsl(expression) + ", " + nextExpression + ", " + radius + ")");
        }
    }

    return expression;
}

function compileChamferCsgGlsl(expr, context, stack, pText, operation) {
    let radiusIndex = expr.args.length - 1;
    let radius = "";
    let expression = "";
    let nextExpression = "";
    let index = 0;

    if (!requireMinimumArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    expression = compileExprGlsl(expr.args[0], context, stack, pText);
    radius = numberArgText(expr, context, radiusIndex);

    for (index = 1; index < radiusIndex; index += 1) {
        nextExpression = compileExprGlsl(expr.args[index], context, stack, pText);

        if (operation === "union") {
            expression = "op_chamfer_union(" + expression + ", " + nextExpression + ", " + radius + ")";
        }

        if (operation === "intersect") {
            expression = "op_chamfer_intersect(" + expression + ", " + nextExpression + ", " + radius + ")";
        }

        if (operation === "subtract") {
            expression = "op_chamfer_subtract(" + expression + ", " + nextExpression + ", " + radius + ")";
        }
    }

    return expression;
}

function compileCsgSampleGlsl(expr, context, stack, pText, operation) {
    let expression = "";
    let nextExpression = "";
    let index = 0;

    if (!requireMinimumArgCount(expr, context, 2)) {
        return "sdf_default_sample(1000000.0)";
    }

    expression = compileExprSampleGlsl(expr.args[0], context, stack, pText);

    for (index = 1; index < expr.args.length; index += 1) {
        nextExpression = compileExprSampleGlsl(expr.args[index], context, stack, pText);

        if (operation === "union") {
            expression = "sdf_union_sample(" + expression + ", " + nextExpression + ")";
        }

        if (operation === "intersect") {
            expression = "sdf_intersect_sample(" + expression + ", " + nextExpression + ")";
        }

        if (operation === "subtract") {
            expression = "sdf_subtract_sample(" + expression + ", " + nextExpression + ")";
        }
    }

    return expression;
}

function compileSmoothCsgSampleGlsl(expr, context, stack, pText, operation) {
    let radiusIndex = expr.args.length - 1;
    let radius = "";
    let expression = "";
    let nextExpression = "";
    let index = 0;

    if (!requireMinimumArgCount(expr, context, 3)) {
        return "sdf_default_sample(1000000.0)";
    }

    radius = numberArgText(expr, context, radiusIndex);
    expression = compileExprSampleGlsl(expr.args[0], context, stack, pText);

    for (index = 1; index < radiusIndex; index += 1) {
        nextExpression = compileExprSampleGlsl(expr.args[index], context, stack, pText);

        if (operation === "union") {
            expression = "sdf_smooth_union_sample(" + expression + ", " + nextExpression + ", " + radius + ")";
        }

        if (operation === "intersect") {
            expression = "sdf_smooth_intersect_sample(" + expression + ", " + nextExpression + ", " + radius + ")";
        }

        if (operation === "subtract") {
            expression = "sdf_smooth_subtract_sample(" + expression + ", " + nextExpression + ", " + radius + ")";
        }
    }

    return expression;
}

function compileChamferCsgSampleGlsl(expr, context, stack, pText, operation) {
    let radiusIndex = expr.args.length - 1;
    let radius = "";
    let expression = "";
    let nextExpression = "";
    let index = 0;

    if (!requireMinimumArgCount(expr, context, 3)) {
        return "sdf_default_sample(1000000.0)";
    }

    radius = numberArgText(expr, context, radiusIndex);
    expression = compileExprSampleGlsl(expr.args[0], context, stack, pText);

    for (index = 1; index < radiusIndex; index += 1) {
        nextExpression = compileExprSampleGlsl(expr.args[index], context, stack, pText);

        if (operation === "union") {
            expression = "sdf_chamfer_union_sample(" + expression + ", " + nextExpression + ", " + radius + ")";
        }

        if (operation === "intersect") {
            expression = "sdf_chamfer_intersect_sample(" + expression + ", " + nextExpression + ", " + radius + ")";
        }

        if (operation === "subtract") {
            expression = "sdf_chamfer_subtract_sample(" + expression + ", " + nextExpression + ", " + radius + ")";
        }
    }

    return expression;
}

function compileMoveGlsl(expr, context, stack, pText) {
    let movedP = "";

    if (!requireArgCount(expr, context, 2)) {
        return "1000000.0";
    }

    movedP = "(" + pText + " - " + vectorArgText(expr, context, 1) + ")";

    return compileExprGlsl(expr.args[0], context, stack, movedP);
}

function compileScaleGlsl(expr, context, stack, pText) {
    let sxValue = 1.0;
    let syValue = 1.0;
    let szValue = 1.0;
    let sx = "";
    let sy = "";
    let sz = "";
    let distanceScale = "";
    let scaledP = "";
    let expression = "";

    if (!requireArgCount(expr, context, 2)) {
        return "1000000.0";
    }

    if (isVectorValue(expr.args[1], context, [])) {
        let scaleVector = vectorArgValue(expr, context, 1);
        sxValue = scaleVector[0];
        syValue = scaleVector[1];
        szValue = scaleVector[2];
    } else {
        sxValue = numberArgValue(expr, context, 1);
        syValue = sxValue;
        szValue = sxValue;
    }

    if (sxValue <= 0.0001 || syValue <= 0.0001 || szValue <= 0.0001) {
        context.errors.push("Scale arguments must be greater than zero.");
        return "1000000.0";
    }

    sx = formatNumber(sxValue);
    sy = formatNumber(syValue);
    sz = formatNumber(szValue);
    distanceScale = formatNumber(Math.min(sxValue, Math.min(syValue, szValue)));

    if (sxValue === syValue && sxValue === szValue) {
        scaledP = "(" + pText + " / " + sx + ")";
    } else {
        scaledP = "(" + pText + " / vec3(" + sx + ", " + sy + ", " + sz + "))";
    }

    expression = compileExprGlsl(expr.args[0], context, stack, scaledP);

    return "(" + expression + " * " + distanceScale + ")";
}

function compileRotateGlsl(expr, context, stack, pText) {
    let axis = [0.0, 0.0, 0.0];
    let axisLength = 0.0;
    let rotatedP = "";

    if (!requireArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    axis = vectorArgValue(expr, context, 1);
    axisLength = Math.hypot(axis[0], axis[1], axis[2]);

    if (axisLength <= 0.0001) {
        context.errors.push("Rotate axis vector must not be zero.");
        return "1000000.0";
    }

    rotatedP = "rotate_point(" + pText + ", normalize(vec3("
        + formatNumber(axis[0]) + ", "
        + formatNumber(axis[1]) + ", "
        + formatNumber(axis[2]) + ")), radians("
        + numberArgText(expr, context, 2) + "))";

    return compileExprGlsl(expr.args[0], context, stack, rotatedP);
}

function compileRoundGlsl(expr, context, stack, pText) {
    let expression = "";
    let radius = "";

    if (!requireArgCount(expr, context, 2)) {
        return "1000000.0";
    }

    expression = compileExprGlsl(expr.args[0], context, stack, pText);
    radius = numberArgText(expr, context, 1);

    return "(" + expression + " - " + radius + ")";
}

function compileShellGlsl(expr, context, stack, pText) {
    let expression = "";
    let thickness = "";

    if (!requireArgCount(expr, context, 2)) {
        return "1000000.0";
    }

    expression = compileExprGlsl(expr.args[0], context, stack, pText);
    thickness = numberArgText(expr, context, 1);

    return "(abs(" + expression + ") - " + thickness + ")";
}

function compileMoveSampleGlsl(expr, context, stack, pText) {
    let movedP = "";

    if (!requireArgCount(expr, context, 2)) {
        return "sdf_default_sample(1000000.0)";
    }

    movedP = "(" + pText + " - " + vectorArgText(expr, context, 1) + ")";

    return compileExprSampleGlsl(expr.args[0], context, stack, movedP);
}

function compileScaleSampleGlsl(expr, context, stack, pText) {
    let sxValue = 1.0;
    let syValue = 1.0;
    let szValue = 1.0;
    let sx = "";
    let sy = "";
    let sz = "";
    let distanceScale = "";
    let scaledP = "";
    let expression = "";

    if (!requireArgCount(expr, context, 2)) {
        return "sdf_default_sample(1000000.0)";
    }

    if (isVectorValue(expr.args[1], context, [])) {
        let scaleVector = vectorArgValue(expr, context, 1);
        sxValue = scaleVector[0];
        syValue = scaleVector[1];
        szValue = scaleVector[2];
    } else {
        sxValue = numberArgValue(expr, context, 1);
        syValue = sxValue;
        szValue = sxValue;
    }

    if (sxValue <= 0.0001 || syValue <= 0.0001 || szValue <= 0.0001) {
        context.errors.push("Scale arguments must be greater than zero.");
        return "sdf_default_sample(1000000.0)";
    }

    sx = formatNumber(sxValue);
    sy = formatNumber(syValue);
    sz = formatNumber(szValue);
    distanceScale = formatNumber(Math.min(sxValue, Math.min(syValue, szValue)));

    if (sxValue === syValue && sxValue === szValue) {
        scaledP = "(" + pText + " / " + sx + ")";
    } else {
        scaledP = "(" + pText + " / vec3(" + sx + ", " + sy + ", " + sz + "))";
    }

    expression = compileExprSampleGlsl(expr.args[0], context, stack, scaledP);

    return "sdf_scale_sample(" + expression + ", " + distanceScale + ")";
}

function compileRotateSampleGlsl(expr, context, stack, pText) {
    let axis = [0.0, 0.0, 0.0];
    let axisLength = 0.0;
    let rotatedP = "";

    if (!requireArgCount(expr, context, 3)) {
        return "sdf_default_sample(1000000.0)";
    }

    axis = vectorArgValue(expr, context, 1);
    axisLength = Math.hypot(axis[0], axis[1], axis[2]);

    if (axisLength <= 0.0001) {
        context.errors.push("Rotate axis vector must not be zero.");
        return "sdf_default_sample(1000000.0)";
    }

    rotatedP = "rotate_point(" + pText + ", normalize(vec3("
        + formatNumber(axis[0]) + ", "
        + formatNumber(axis[1]) + ", "
        + formatNumber(axis[2]) + ")), radians("
        + numberArgText(expr, context, 2) + "))";

    return compileExprSampleGlsl(expr.args[0], context, stack, rotatedP);
}

function compileRoundSampleGlsl(expr, context, stack, pText) {
    let expression = "";
    let radius = "";

    if (!requireArgCount(expr, context, 2)) {
        return "sdf_default_sample(1000000.0)";
    }

    expression = compileExprSampleGlsl(expr.args[0], context, stack, pText);
    radius = numberArgText(expr, context, 1);

    return "sdf_offset_sample(" + expression + ", " + radius + ")";
}

function compileShellSampleGlsl(expr, context, stack, pText) {
    let expression = "";
    let thickness = "";

    if (!requireArgCount(expr, context, 2)) {
        return "sdf_default_sample(1000000.0)";
    }

    expression = compileExprSampleGlsl(expr.args[0], context, stack, pText);
    thickness = numberArgText(expr, context, 1);

    return "sdf_shell_sample(" + expression + ", " + thickness + ")";
}

function compilePrimitiveOperationGlsl(expr, context, stack, pText, operation) {
    let args = [];
    let index = 0;
    let expression = "";

    if (operation === "abs") {
        if (!requireArgCount(expr, context, 1)) {
            return "1000000.0";
        }

        return "abs(" + compileExprGlsl(expr.args[0], context, stack, pText) + ")";
    }

    if (operation === "div" || operation === "mod" || operation === "pow") {
        if (!requireArgCount(expr, context, 2)) {
            return "1000000.0";
        }

        args.push(compileExprGlsl(expr.args[0], context, stack, pText));
        args.push(compileExprGlsl(expr.args[1], context, stack, pText));

        if (operation === "div") {
            return "((" + args[0] + ") / (" + args[1] + "))";
        }

        if (operation === "mod") {
            return "mod(" + args[0] + ", " + args[1] + ")";
        }

        return "pow(" + args[0] + ", " + args[1] + ")";
    }

    if (!requireMinimumArgCount(expr, context, 2)) {
        return "1000000.0";
    }

    for (index = 0; index < expr.args.length; index += 1) {
        args.push(compileExprGlsl(expr.args[index], context, stack, pText));
    }

    expression = args[0];

    for (index = 1; index < args.length; index += 1) {
        if (operation === "min") {
            expression = "min(" + expression + ", " + args[index] + ")";
        }

        if (operation === "max") {
            expression = "max(" + expression + ", " + args[index] + ")";
        }

        if (operation === "add") {
            expression = "(" + expression + " + " + args[index] + ")";
        }

        if (operation === "mul") {
            expression = "(" + expression + " * " + args[index] + ")";
        }
    }

    return expression;
}

export function compileSdfFunction(parsed, bounds) {
    let result = {
        ok: false,
        sample: null,
        source: "",
        errors: [],
        primitiveCount: 0
    };
    let context = {
        parsed: parsed,
        errors: [],
        primitiveCount: 0,
        scopes: [],
        macroStack: [],
        nextScopeId: 1
    };
    let stack = [];
    let expression = "";
    let source = "";

    if (!parsed) {
        result.errors.push("No parsed script was provided.");
        return result;
    }

    if (!parsed.ok) {
        copyErrors(result.errors, parsed.errors);
        return result;
    }

    if (!parsed.rootExpr) {
        result.errors.push("No render expression was found.");
        return result;
    }

    stack.push("root");
    expression = compileExprJs(parsed.rootExpr, context, stack, pointExpr("x", "y", "z"));

    if (context.errors.length > 0) {
        copyErrors(result.errors, context.errors);
        return result;
    }

    source = buildSdfFunctionSource(expression, boundsVolumeSize(bounds));

    try {
        result.sample = new Function(source)();
    } catch (error) {
        result.errors.push("Generated JS SDF failed: " + error.message);
        return result;
    }

    result.ok = true;
    result.source = source;
    result.primitiveCount = context.primitiveCount;

    return result;
}

function buildSdfFunctionSource(expression, boundValue) {
    return [
        generatedSdfHelperSource(),
        "return function sampleSdf(x, y, z) {",
        "    let objectSdf = " + expression + ";",
        "    let boundsSize = " + formatNumber(boundValue) + ";",
        "    let boundsSdf = -z;",
        "    let halfSize = 0.0;",
        "    if (boundsSize > 0.0) {",
        "        halfSize = boundsSize * 0.5;",
        "        boundsSdf = sdBox(x, y, z - halfSize, halfSize, halfSize, halfSize);",
        "    }",
        "    return Math.max(objectSdf, boundsSdf);",
        "};"
    ].join("\n");
}

function compileExprJs(expr, context, stack, p) {
    let callName = "";

    if (expr.kind === "number") {
        return formatNumber(expr.value);
    }

    if (expr.kind === "list" || expr.kind === "for_range" || expr.kind === "for_each") {
        context.errors.push("List value cannot be used as a shape.");
        return "1000000.0";
    }

    if (expr.kind === "captured") {
        return compileCapturedWrapperJs(expr, context, stack, p);
    }

    if (expr.kind === "spread") {
        context.errors.push("Spread arguments are only allowed inside function calls.");
        return "1000000.0";
    }

    if (expr.kind === "block") {
        return compileBlockJs(expr, context, stack, p);
    }

    if (expr.kind === "name") {
        return compileNameJs(expr.name, context, stack, p);
    }

    if (expr.kind !== "call") {
        context.errors.push("Unsupported expression.");
        return "1000000.0";
    }

    expr = expandCallExpr(expr, context, stack);
    callName = expr.name.toLowerCase();

    switch (callName) {
        case "sphere":
            return compileSphereJs(expr, context, p);
        case "box":
            return compileBoxJs(expr, context, p);
        case "rounded_box":
            return compileRoundedBoxJs(expr, context, p);
        case "box_frame":
            return compileBoxFrameJs(expr, context, p);
        case "chamfer_box":
            return compileChamferBoxJs(expr, context, p);
        case "cylinder":
            return compileCylinderJs(expr, context, p);
        case "rounded_cylinder":
            return compileRoundedCylinderJs(expr, context, p);
        case "chamfer_cylinder":
            return compileChamferCylinderJs(expr, context, p);
        case "tri_prism":
            return compileTriPrismJs(expr, context, p);
        case "hex_prism":
            return compileHexPrismJs(expr, context, p);
        case "octagon_prism":
            return compileOctagonPrismJs(expr, context, p);
        case "cone":
            return compileConeJs(expr, context, p);
        case "rounded_cone":
            return compileRoundedConeJs(expr, context, p);
        case "chamfer_cone":
            return compileChamferConeJs(expr, context, p);
        case "pyramid":
            return compilePyramidJs(expr, context, p);
        case "octahedron":
            return compileOctahedronJs(expr, context, p);
        case "torus":
            return compileTorusJs(expr, context, p);
        case "capped_torus":
            return compileCappedTorusJs(expr, context, p);
        case "capped_cylinder":
        case "capped_line":
            return compileCappedCylinderJs(expr, context, p);
        case "capped_cone":
            return compileCappedConeJs(expr, context, p);
        case "union":
            return compileCsgJs(expr, context, stack, p, "union");
        case "intersect":
            return compileCsgJs(expr, context, stack, p, "intersect");
        case "subtract":
            return compileCsgJs(expr, context, stack, p, "subtract");
        case "smooth_union":
            return compileSmoothCsgJs(expr, context, stack, p, "union");
        case "smooth_intersect":
            return compileSmoothCsgJs(expr, context, stack, p, "intersect");
        case "smooth_subtract":
            return compileSmoothCsgJs(expr, context, stack, p, "subtract");
        case "chamfer_union":
            return compileChamferCsgJs(expr, context, stack, p, "union");
        case "chamfer_intersect":
            return compileChamferCsgJs(expr, context, stack, p, "intersect");
        case "chamfer_subtract":
            return compileChamferCsgJs(expr, context, stack, p, "subtract");
        case "color":
            return compileColorJs(expr, context, stack, p);
        case "move":
            return compileMoveJs(expr, context, stack, p);
        case "scale":
            return compileScaleJs(expr, context, stack, p);
        case "rotate":
            return compileRotateJs(expr, context, stack, p);
        case "round":
            return compileRoundJs(expr, context, stack, p);
        case "shell":
            return compileShellJs(expr, context, stack, p);
    }

    if (isPrimitiveOperationName(callName)) {
        return compilePrimitiveOperationJs(expr, context, stack, p, callName);
    }

    if (findMacroIndex(context.parsed, expr.name) >= 0) {
        return compileMacroCallJs(expr, context, stack, p);
    }

    context.errors.push("Unknown function '" + expr.name + "'.");
    return "1000000.0";
}

function compileNameJs(name, context, stack, p) {
    let reference = findScopedAssignment(context, name);
    let stackIndex = 0;
    let expression = "";

    if (!reference.found) {
        context.errors.push("Unknown shape name '" + name + "'.");
        return "1000000.0";
    }

    for (stackIndex = 0; stackIndex < stack.length; stackIndex += 1) {
        if (stack[stackIndex] === reference.key) {
            context.errors.push("Cyclic shape reference involving '" + name + "'.");
            return "1000000.0";
        }
    }

    stack.push(reference.key);
    expression = compileCapturedExprJs(reference, context, stack, p);
    stack.pop();

    return expression;
}

function compileCapturedExprJs(reference, context, stack, p) {
    let expression = "";
    let savedScopes = null;

    if (!reference.capturedScopes) {
        return compileExprJs(reference.expr, context, stack, p);
    }

    savedScopes = context.scopes;
    context.scopes = reference.capturedScopes;
    expression = compileExprJs(reference.expr, context, stack, p);
    context.scopes = savedScopes;

    return expression;
}

function compileBlockJs(expr, context, stack, p) {
    let resultIndex = blockResultIndex(expr);
    let scopeId = -1;
    let expression = "";

    if (resultIndex < 0) {
        context.errors.push("Block expression must assign at least one value.");
        return "1000000.0";
    }

    scopeId = pushCompilerScope(context, expr);
    stack.push("s:" + scopeId + ":" + resultIndex);
    expression = compileExprJs(expr.exprs[resultIndex], context, stack, p);
    stack.pop();
    context.scopes.pop();

    return expression;
}

function compileMacroCallJs(expr, context, stack, p) {
    let macro = findMacro(context.parsed, expr.name);
    let macroIndex = 0;
    let expression = "";
    let scope = null;

    if (!macro) {
        context.errors.push("Unknown function '" + expr.name + "'.");
        return "1000000.0";
    }

    if (expr.args.length !== macro.params.length) {
        context.errors.push(
            "Macro '" + expr.name + "' expected "
            + macro.params.length + " arguments but received "
            + expr.args.length + "."
        );
        return "1000000.0";
    }

    for (macroIndex = 0; macroIndex < context.macroStack.length; macroIndex += 1) {
        if (context.macroStack[macroIndex] === macro.name) {
            context.errors.push("Recursive macro call involving '" + macro.name + "'.");
            return "1000000.0";
        }
    }

    scope = {
        names: macro.params,
        exprs: expr.args,
        capturedScopes: context.scopes.slice()
    };

    context.macroStack.push(macro.name);
    pushCompilerScope(context, scope);
    expression = compileExprJs(macro.body, context, stack, p);
    context.scopes.pop();
    context.macroStack.pop();

    return expression;
}

function compileCapturedWrapperJs(expr, context, stack, p) {
    let savedScopes = context.scopes;
    let expression = "";

    context.scopes = expr.capturedScopes;
    expression = compileExprJs(expr.expr, context, stack, p);
    context.scopes = savedScopes;

    return expression;
}

function compileSphereJs(expr, context, p) {
    let center = null;
    let local = null;

    if (!requireArgCount(expr, context, 2)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;
    center = vectorArgValue(expr, context, 0);
    local = offsetPoint(p, -center[0], -center[1], -center[2]);

    return "sdSphere(" + local.x + ", " + local.y + ", " + local.z + ", " + numberArgText(expr, context, 1) + ")";
}

function compileBoxJs(expr, context, p) {
    let center = null;
    let size = null;
    let local = null;

    if (!requireArgCount(expr, context, 2)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;
    center = vectorArgValue(expr, context, 0);
    size = boxSizeArgValue(expr, context, 1);
    local = offsetPoint(p, -center[0], -center[1], -center[2]);

    return "sdBox(" + local.x + ", " + local.y + ", " + local.z + ", "
        + formatNumber(size[0] * 0.5) + ", " + formatNumber(size[1] * 0.5) + ", " + formatNumber(size[2] * 0.5) + ")";
}

function compileRoundedBoxJs(expr, context, p) {
    let center = null;
    let size = null;
    let local = null;

    if (!requireArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;
    center = vectorArgValue(expr, context, 0);
    size = boxSizeArgValue(expr, context, 1);
    local = offsetPoint(p, -center[0], -center[1], -center[2]);

    return "sdRoundedBox(" + local.x + ", " + local.y + ", " + local.z + ", "
        + formatNumber(size[0] * 0.5) + ", " + formatNumber(size[1] * 0.5) + ", " + formatNumber(size[2] * 0.5) + ", "
        + numberArgText(expr, context, 2) + ")";
}

function compileBoxFrameJs(expr, context, p) {
    let center = null;
    let size = null;
    let local = null;

    if (!requireArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;
    center = vectorArgValue(expr, context, 0);
    size = boxSizeArgValue(expr, context, 1);
    local = offsetPoint(p, -center[0], -center[1], -center[2]);

    return "sdBoxFrame(" + local.x + ", " + local.y + ", " + local.z + ", "
        + formatNumber(size[0] * 0.5) + ", " + formatNumber(size[1] * 0.5) + ", " + formatNumber(size[2] * 0.5) + ", "
        + numberArgText(expr, context, 2) + ")";
}

function compileChamferBoxJs(expr, context, p) {
    let center = null;
    let size = null;
    let local = null;

    if (!requireArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;
    center = vectorArgValue(expr, context, 0);
    size = vectorArgValue(expr, context, 1);
    local = offsetPoint(p, -center[0], -center[1], -center[2]);

    return "sdChamferBox(" + local.x + ", " + local.y + ", " + local.z + ", "
        + formatNumber(size[0] * 0.5) + ", " + formatNumber(size[1] * 0.5) + ", " + formatNumber(size[2] * 0.5) + ", "
        + numberArgText(expr, context, 2) + ")";
}

function compileCylinderJs(expr, context, p) {
    let center = null;
    let local = null;

    if (!requireArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;
    center = vectorArgValue(expr, context, 0);
    local = offsetPoint(p, -center[0], -center[1], -center[2]);

    return "sdCylinder(" + local.x + ", " + local.y + ", " + local.z + ", "
        + numberArgText(expr, context, 1) + ", " + halfNumberArgText(expr, context, 2) + ")";
}

function compileRoundedCylinderJs(expr, context, p) {
    let center = null;
    let local = null;

    if (!requireArgCount(expr, context, 4)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;
    center = vectorArgValue(expr, context, 0);
    local = offsetPoint(p, -center[0], -center[1], -center[2]);

    return "sdRoundedCylinder(" + local.x + ", " + local.y + ", " + local.z + ", "
        + numberArgText(expr, context, 1) + ", " + halfNumberArgText(expr, context, 2) + ", "
        + numberArgText(expr, context, 3) + ")";
}

function compileChamferCylinderJs(expr, context, p) {
    let center = null;
    let local = null;

    if (!requireArgCount(expr, context, 4)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;
    center = vectorArgValue(expr, context, 0);
    local = offsetPoint(p, -center[0], -center[1], -center[2]);

    return "sdChamferCylinder(" + local.x + ", " + local.y + ", " + local.z + ", "
        + numberArgText(expr, context, 1) + ", " + halfNumberArgText(expr, context, 2) + ", "
        + numberArgText(expr, context, 3) + ")";
}

function compileTriPrismJs(expr, context, p) {
    return compileCenteredRadiusHeightPrimitiveJs(expr, context, p, "sdTriPrism");
}

function compileHexPrismJs(expr, context, p) {
    return compileCenteredRadiusHeightPrimitiveJs(expr, context, p, "sdHexPrism");
}

function compileOctagonPrismJs(expr, context, p) {
    return compileCenteredRadiusHeightPrimitiveJs(expr, context, p, "sdOctagonPrism");
}

function compileCenteredRadiusHeightPrimitiveJs(expr, context, p, helperName) {
    let center = null;
    let local = null;

    if (!requireArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;
    center = vectorArgValue(expr, context, 0);
    local = offsetPoint(p, -center[0], -center[1], -center[2]);

    return helperName + "(" + local.x + ", " + local.y + ", " + local.z + ", "
        + numberArgText(expr, context, 1) + ", " + halfNumberArgText(expr, context, 2) + ")";
}

function compileConeJs(expr, context, p) {
    let center = null;
    let local = null;

    if (!requireArgCount(expr, context, 4)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;
    center = vectorArgValue(expr, context, 0);
    local = offsetPoint(p, -center[0], -center[1], -center[2]);

    return "sdCone(" + local.x + ", " + local.y + ", " + local.z + ", "
        + numberArgText(expr, context, 1) + ", "
        + numberArgText(expr, context, 2) + ", "
        + numberArgText(expr, context, 3) + ")";
}

function compileRoundedConeJs(expr, context, p) {
    let center = null;
    let local = null;

    if (!requireArgCount(expr, context, 5)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;
    center = vectorArgValue(expr, context, 0);
    local = offsetPoint(p, -center[0], -center[1], -center[2]);

    return "sdRoundedCone(" + local.x + ", " + local.y + ", " + local.z + ", "
        + numberArgText(expr, context, 1) + ", "
        + numberArgText(expr, context, 2) + ", "
        + numberArgText(expr, context, 3) + ", "
        + numberArgText(expr, context, 4) + ")";
}

function compileChamferConeJs(expr, context, p) {
    let center = null;
    let local = null;

    if (!requireArgCount(expr, context, 5)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;
    center = vectorArgValue(expr, context, 0);
    local = offsetPoint(p, -center[0], -center[1], -center[2]);

    return "sdChamferCone(" + local.x + ", " + local.y + ", " + local.z + ", "
        + numberArgText(expr, context, 1) + ", "
        + numberArgText(expr, context, 2) + ", "
        + numberArgText(expr, context, 3) + ", "
        + numberArgText(expr, context, 4) + ")";
}

function compilePyramidJs(expr, context, p) {
    let center = null;
    let local = null;

    if (!requireArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;
    center = vectorArgValue(expr, context, 0);
    local = offsetPoint(p, -center[0], -center[1], -center[2]);

    return "sdPyramid(" + local.x + ", " + local.y + ", " + local.z + ", "
        + numberArgText(expr, context, 1) + ", "
        + numberArgText(expr, context, 2) + ")";
}

function compileOctahedronJs(expr, context, p) {
    let center = null;
    let local = null;

    if (!requireArgCount(expr, context, 2)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;
    center = vectorArgValue(expr, context, 0);
    local = offsetPoint(p, -center[0], -center[1], -center[2]);

    return "sdOctahedron(" + local.x + ", " + local.y + ", " + local.z + ", "
        + numberArgText(expr, context, 1) + ")";
}

function compileTorusJs(expr, context, p) {
    let center = null;
    let local = null;

    if (!requireArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;
    center = vectorArgValue(expr, context, 0);
    local = offsetPoint(p, -center[0], -center[1], -center[2]);

    return "sdTorus(" + local.x + ", " + local.y + ", " + local.z + ", "
        + numberArgText(expr, context, 1) + ", "
        + numberArgText(expr, context, 2) + ")";
}

function compileCappedTorusJs(expr, context, p) {
    let center = null;
    let local = null;

    if (!requireArgCount(expr, context, 5)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;
    center = vectorArgValue(expr, context, 0);
    local = offsetPoint(p, -center[0], -center[1], -center[2]);

    return "sdCappedTorus(" + local.x + ", " + local.y + ", " + local.z + ", "
        + numberArgText(expr, context, 1) + ", "
        + numberArgText(expr, context, 2) + ", "
        + numberArgText(expr, context, 3) + ", "
        + numberArgText(expr, context, 4) + ")";
}

function compileCappedCylinderJs(expr, context, p) {
    let start = null;
    let end = null;

    if (!requireArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;
    start = vectorArgValue(expr, context, 0);
    end = vectorArgValue(expr, context, 1);

    return "sdCappedCylinder(" + p.x + ", " + p.y + ", " + p.z + ", "
        + formatNumber(start[0]) + ", " + formatNumber(start[1]) + ", " + formatNumber(start[2]) + ", "
        + formatNumber(end[0]) + ", " + formatNumber(end[1]) + ", " + formatNumber(end[2]) + ", "
        + numberArgText(expr, context, 2) + ")";
}

function compileCappedConeJs(expr, context, p) {
    let start = null;
    let end = null;

    if (!requireArgCount(expr, context, 4)) {
        return "1000000.0";
    }

    context.primitiveCount += 1;
    start = vectorArgValue(expr, context, 0);
    end = vectorArgValue(expr, context, 1);

    return "sdCappedCone(" + p.x + ", " + p.y + ", " + p.z + ", "
        + formatNumber(start[0]) + ", " + formatNumber(start[1]) + ", " + formatNumber(start[2]) + ", "
        + formatNumber(end[0]) + ", " + formatNumber(end[1]) + ", " + formatNumber(end[2]) + ", "
        + numberArgText(expr, context, 2) + ", "
        + numberArgText(expr, context, 3) + ")";
}

function compileCsgJs(expr, context, stack, p, operation) {
    let args = [];
    let index = 0;
    let expression = "";

    if (!requireMinimumArgCount(expr, context, 2)) {
        return "1000000.0";
    }

    for (index = 0; index < expr.args.length; index += 1) {
        args.push(compileExprJs(expr.args[index], context, stack, p));
    }

    expression = args[0];

    for (index = 1; index < args.length; index += 1) {
        if (operation === "union") {
            expression = "Math.min(" + expression + ", " + args[index] + ")";
        }

        if (operation === "intersect") {
            expression = "Math.max(" + expression + ", " + args[index] + ")";
        }

        if (operation === "subtract") {
            expression = "Math.max(" + expression + ", -(" + args[index] + "))";
        }
    }

    return expression;
}

function compileSmoothCsgJs(expr, context, stack, p, operation) {
    let radiusIndex = expr.args.length - 1;
    let radius = "";
    let expression = "";
    let nextExpression = "";
    let index = 0;

    if (!requireMinimumArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    radius = numberArgText(expr, context, radiusIndex);
    expression = compileExprJs(expr.args[0], context, stack, p);

    for (index = 1; index < radiusIndex; index += 1) {
        nextExpression = compileExprJs(expr.args[index], context, stack, p);

        if (operation === "union") {
            expression = "smoothUnion(" + expression + ", " + nextExpression + ", " + radius + ")";
        }

        if (operation === "intersect") {
            expression = "-smoothUnion(-(" + expression + "), -(" + nextExpression + "), " + radius + ")";
        }

        if (operation === "subtract") {
            expression = "-smoothUnion(-(" + expression + "), " + nextExpression + ", " + radius + ")";
        }
    }

    return expression;
}

function compileChamferCsgJs(expr, context, stack, p, operation) {
    let radiusIndex = expr.args.length - 1;
    let radius = "";
    let expression = "";
    let nextExpression = "";
    let index = 0;

    if (!requireMinimumArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    radius = numberArgText(expr, context, radiusIndex);
    expression = compileExprJs(expr.args[0], context, stack, p);

    for (index = 1; index < radiusIndex; index += 1) {
        nextExpression = compileExprJs(expr.args[index], context, stack, p);

        if (operation === "union") {
            expression = "chamferUnion(" + expression + ", " + nextExpression + ", " + radius + ")";
        }

        if (operation === "intersect") {
            expression = "chamferIntersect(" + expression + ", " + nextExpression + ", " + radius + ")";
        }

        if (operation === "subtract") {
            expression = "chamferIntersect(" + expression + ", -(" + nextExpression + "), " + radius + ")";
        }
    }

    return expression;
}

function compileColorJs(expr, context, stack, p) {
    if (!requireArgCount(expr, context, 2)) {
        return "1000000.0";
    }

    vectorArgValue(expr, context, 1);

    return compileExprJs(expr.args[0], context, stack, p);
}

function compileMoveJs(expr, context, stack, p) {
    let offset = null;

    if (!requireArgCount(expr, context, 2)) {
        return "1000000.0";
    }

    offset = vectorArgValue(expr, context, 1);

    return compileExprJs(expr.args[0], context, stack, offsetPoint(p, -offset[0], -offset[1], -offset[2]));
}

function compileScaleJs(expr, context, stack, p) {
    let sxValue = 1.0;
    let syValue = 1.0;
    let szValue = 1.0;
    let distanceScale = 1.0;
    let scaleVector = null;
    let scaledPoint = null;
    let expression = "";

    if (!requireArgCount(expr, context, 2)) {
        return "1000000.0";
    }

    if (isVectorValue(expr.args[1], context, [])) {
        scaleVector = vectorArgValue(expr, context, 1);
        sxValue = scaleVector[0];
        syValue = scaleVector[1];
        szValue = scaleVector[2];
    } else {
        sxValue = numberArgValue(expr, context, 1);
        syValue = sxValue;
        szValue = sxValue;
    }

    if (sxValue <= 0.0001 || syValue <= 0.0001 || szValue <= 0.0001) {
        context.errors.push("Scale arguments must be greater than zero.");
        return "1000000.0";
    }

    distanceScale = Math.min(sxValue, Math.min(syValue, szValue));
    scaledPoint = pointExpr("(" + p.x + " / " + formatNumber(sxValue) + ")", "(" + p.y + " / " + formatNumber(syValue) + ")", "(" + p.z + " / " + formatNumber(szValue) + ")");
    expression = compileExprJs(expr.args[0], context, stack, scaledPoint);

    return "(" + expression + " * " + formatNumber(distanceScale) + ")";
}

function compileRotateJs(expr, context, stack, p) {
    let axis = null;
    let axisLength = 0.0;
    let axisX = 0.0;
    let axisY = 0.0;
    let axisZ = 0.0;
    let angle = 0.0;
    let c = 0.0;
    let s = 0.0;
    let oneMinusC = 0.0;
    let dotValue = "";
    let crossX = "";
    let crossY = "";
    let crossZ = "";
    let local = null;

    if (!requireArgCount(expr, context, 3)) {
        return "1000000.0";
    }

    axis = vectorArgValue(expr, context, 1);
    axisLength = Math.hypot(axis[0], axis[1], axis[2]);

    if (axisLength <= 0.0001) {
        context.errors.push("Rotate axis vector must not be zero.");
        return "1000000.0";
    }

    axisX = axis[0] / axisLength;
    axisY = axis[1] / axisLength;
    axisZ = axis[2] / axisLength;
    angle = numberArgValue(expr, context, 2) * Math.PI / 180.0;
    c = Math.cos(angle);
    s = Math.sin(angle);
    oneMinusC = 1.0 - c;
    dotValue = "((" + p.x + ") * " + formatNumber(axisX) + " + (" + p.y + ") * " + formatNumber(axisY) + " + (" + p.z + ") * " + formatNumber(axisZ) + ")";
    crossX = "(" + formatNumber(axisY) + " * (" + p.z + ") - " + formatNumber(axisZ) + " * (" + p.y + "))";
    crossY = "(" + formatNumber(axisZ) + " * (" + p.x + ") - " + formatNumber(axisX) + " * (" + p.z + "))";
    crossZ = "(" + formatNumber(axisX) + " * (" + p.y + ") - " + formatNumber(axisY) + " * (" + p.x + "))";
    local = pointExpr(
        "((" + p.x + ") * " + formatNumber(c) + " + " + crossX + " * " + formatNumber(s) + " + " + formatNumber(axisX) + " * " + dotValue + " * " + formatNumber(oneMinusC) + ")",
        "((" + p.y + ") * " + formatNumber(c) + " + " + crossY + " * " + formatNumber(s) + " + " + formatNumber(axisY) + " * " + dotValue + " * " + formatNumber(oneMinusC) + ")",
        "((" + p.z + ") * " + formatNumber(c) + " + " + crossZ + " * " + formatNumber(s) + " + " + formatNumber(axisZ) + " * " + dotValue + " * " + formatNumber(oneMinusC) + ")"
    );

    return compileExprJs(expr.args[0], context, stack, local);
}

function compileRoundJs(expr, context, stack, p) {
    let expression = "";

    if (!requireArgCount(expr, context, 2)) {
        return "1000000.0";
    }

    expression = compileExprJs(expr.args[0], context, stack, p);

    return "(" + expression + " - " + numberArgText(expr, context, 1) + ")";
}

function compileShellJs(expr, context, stack, p) {
    let expression = "";

    if (!requireArgCount(expr, context, 2)) {
        return "1000000.0";
    }

    expression = compileExprJs(expr.args[0], context, stack, p);

    return "(Math.abs(" + expression + ") - " + numberArgText(expr, context, 1) + ")";
}

function compilePrimitiveOperationJs(expr, context, stack, p, operation) {
    let args = [];
    let index = 0;
    let expression = "";

    if (operation === "abs") {
        if (!requireArgCount(expr, context, 1)) {
            return "1000000.0";
        }

        return "Math.abs(" + compileExprJs(expr.args[0], context, stack, p) + ")";
    }

    if (operation === "div" || operation === "mod" || operation === "pow") {
        if (!requireArgCount(expr, context, 2)) {
            return "1000000.0";
        }

        args.push(compileExprJs(expr.args[0], context, stack, p));
        args.push(compileExprJs(expr.args[1], context, stack, p));

        if (operation === "div") {
            return "((" + args[0] + ") / (" + args[1] + "))";
        }

        if (operation === "mod") {
            return "positiveModuloValue(" + args[0] + ", " + args[1] + ")";
        }

        return "Math.pow(" + args[0] + ", " + args[1] + ")";
    }

    if (!requireMinimumArgCount(expr, context, 2)) {
        return "1000000.0";
    }

    for (index = 0; index < expr.args.length; index += 1) {
        args.push(compileExprJs(expr.args[index], context, stack, p));
    }

    expression = args[0];

    for (index = 1; index < args.length; index += 1) {
        if (operation === "min") {
            expression = "Math.min(" + expression + ", " + args[index] + ")";
        }

        if (operation === "max") {
            expression = "Math.max(" + expression + ", " + args[index] + ")";
        }

        if (operation === "add") {
            expression = "((" + expression + ") + (" + args[index] + "))";
        }

        if (operation === "mul") {
            expression = "((" + expression + ") * (" + args[index] + "))";
        }
    }

    return expression;
}

function pointExpr(xText, yText, zText) {
    return {
        x: xText,
        y: yText,
        z: zText
    };
}

function offsetPoint(p, dx, dy, dz) {
    return pointExpr(
        "(" + p.x + " + " + formatNumber(dx) + ")",
        "(" + p.y + " + " + formatNumber(dy) + ")",
        "(" + p.z + " + " + formatNumber(dz) + ")"
    );
}

function isPrimitiveOperationName(callName) {
    switch (callName) {
        case "min":
        case "max":
        case "abs":
        case "add":
        case "mul":
        case "div":
        case "mod":
        case "pow":
            return true;
    }

    return false;
}

function requireMinimumArgCount(expr, context, minimumCount) {
    if (expr.args.length >= minimumCount) {
        return true;
    }

    context.errors.push(
        "Function '" + expr.name + "' expected at least "
        + minimumCount + " arguments but received "
        + expr.args.length + "."
    );

    return false;
}

function requireArgCount(expr, context, expectedCount) {
    if (expr.args.length === expectedCount) {
        return true;
    }

    context.errors.push(
        "Function '" + expr.name + "' expected "
        + expectedCount + " arguments but received "
        + expr.args.length + "."
    );

    return false;
}

function numberArgText(expr, context, index) {
    return formatNumber(numberArgValue(expr, context, index));
}

function numberArgValue(expr, context, index) {
    let result = resolveNumberValue(expr.args[index], context, []);

    if (!result.ok) {
        context.errors.push("Argument " + (index + 1) + " to '" + expr.name + "' must be a number.");
        return 0.0;
    }

    return result.value;
}

function vectorArgText(expr, context, index) {
    let value = vectorArgValue(expr, context, index);

    return "vec3(" + formatNumber(value[0]) + ", " + formatNumber(value[1]) + ", " + formatNumber(value[2]) + ")";
}

function halfVectorArgText(expr, context, index) {
    let value = vectorArgValue(expr, context, index);

    return "vec3(" + formatNumber(value[0] * 0.5) + ", " + formatNumber(value[1] * 0.5) + ", " + formatNumber(value[2] * 0.5) + ")";
}

function halfBoxSizeArgText(expr, context, index) {
    let vectorResult = resolveVectorValue(expr.args[index], context, []);
    let numberResult = null;
    let value = [0.0, 0.0, 0.0];

    if (vectorResult.ok) {
        value = vectorResult.value;

        return "vec3(" + formatNumber(value[0] * 0.5) + ", " + formatNumber(value[1] * 0.5) + ", " + formatNumber(value[2] * 0.5) + ")";
    }

    numberResult = resolveNumberValue(expr.args[index], context, []);

    if (numberResult.ok) {
        return "vec3("
            + formatNumber(numberResult.value * 0.5) + ", "
            + formatNumber(numberResult.value * 0.5) + ", "
            + formatNumber(numberResult.value * 0.5) + ")";
    }

    context.errors.push("Argument " + (index + 1) + " to '" + expr.name + "' must be a number or vector.");

    return "vec3(0.0)";
}

function vectorArgValue(expr, context, index) {
    let result = resolveVectorValue(expr.args[index], context, []);

    if (!result.ok) {
        context.errors.push("Argument " + (index + 1) + " to '" + expr.name + "' must be a vector.");
        return [0.0, 0.0, 0.0];
    }

    return result.value;
}

function negateGlsl(text) {
    return "(-(" + text + "))";
}

function halfNumberArgText(expr, context, index) {
    return formatNumber(numberArgValue(expr, context, index) * 0.5);
}

function isVectorValue(expr, context, stack) {
    return resolveVectorValue(expr, context, stack).ok;
}

function resolveNumberValue(expr, context, stack) {
    let reference = null;
    let callName = "";
    let macro = null;
    let resultIndex = -1;
    let scopeId = -1;
    let result = null;

    if (!expr) {
        return {
            ok: false,
            value: 0.0
        };
    }

    if (expr.kind === "number") {
        return {
            ok: true,
            value: expr.value
        };
    }

    if (expr.kind === "captured") {
        return resolveCapturedWrapperNumberValue(expr, context, stack);
    }

    if (expr.kind === "name") {
        reference = findScopedAssignment(context, expr.name);

        if (!reference.found) {
            return {
                ok: false,
                value: 0.0
            };
        }

        if (stackContains(stack, reference.key)) {
            return {
                ok: false,
                value: 0.0
            };
        }

        stack.push(reference.key);
        expr = resolveCapturedNumberValue(reference, context, stack);
        stack.pop();

        return expr;
    }

    if (expr.kind === "block") {
        resultIndex = blockResultIndex(expr);

        if (resultIndex < 0) {
            return {
                ok: false,
                value: 0.0
            };
        }

        scopeId = pushCompilerScope(context, expr);
        stack.push("s:" + scopeId + ":" + resultIndex);
        result = resolveNumberValue(expr.exprs[resultIndex], context, stack);
        stack.pop();
        context.scopes.pop();

        return result;
    }

    if (expr.kind === "call") {
        expr = expandCallExpr(expr, context, stack);
        callName = expr.name.toLowerCase();

        if (isPrimitiveOperationName(callName)) {
            return resolvePrimitiveNumberValue(expr, context, stack, callName);
        }

        macro = findMacro(context.parsed, expr.name);

        if (macro) {
            return resolveMacroNumberValue(expr, context, stack, macro);
        }
    }

    return {
        ok: false,
        value: 0.0
    };
}

function resolveVectorValue(expr, context, stack) {
    let reference = null;
    let list = null;
    let x = null;
    let y = null;
    let z = null;
    let macro = null;
    let resultIndex = -1;
    let scopeId = -1;
    let result = null;

    if (!expr) {
        return {
            ok: false,
            value: [0.0, 0.0, 0.0]
        };
    }

    if (expr.kind === "captured") {
        return resolveCapturedWrapperVectorValue(expr, context, stack);
    }

    if (expr.kind === "list" || expr.kind === "for_range" || expr.kind === "for_each") {
        list = resolveListValue(expr, context, stack);

        if (!list.ok || list.value.length !== 3) {
            return {
                ok: false,
                value: [0.0, 0.0, 0.0]
            };
        }

        x = resolveNumberValue(list.value[0], context, stack);
        y = resolveNumberValue(list.value[1], context, stack);
        z = resolveNumberValue(list.value[2], context, stack);

        if (!x.ok || !y.ok || !z.ok) {
            return {
                ok: false,
                value: [0.0, 0.0, 0.0]
            };
        }

        return {
            ok: true,
            value: [x.value, y.value, z.value]
        };
    }

    if (expr.kind === "name") {
        reference = findScopedAssignment(context, expr.name);

        if (!reference.found) {
            return {
                ok: false,
                value: [0.0, 0.0, 0.0]
            };
        }

        if (stackContains(stack, reference.key)) {
            return {
                ok: false,
                value: [0.0, 0.0, 0.0]
            };
        }

        stack.push(reference.key);
        expr = resolveCapturedVectorValue(reference, context, stack);
        stack.pop();

        return expr;
    }

    if (expr.kind === "block") {
        resultIndex = blockResultIndex(expr);

        if (resultIndex < 0) {
            return {
                ok: false,
                value: [0.0, 0.0, 0.0]
            };
        }

        scopeId = pushCompilerScope(context, expr);
        stack.push("s:" + scopeId + ":" + resultIndex);
        result = resolveVectorValue(expr.exprs[resultIndex], context, stack);
        stack.pop();
        context.scopes.pop();

        return result;
    }

    if (expr.kind === "call") {
        expr = expandCallExpr(expr, context, stack);
        macro = findMacro(context.parsed, expr.name);

        if (macro) {
            return resolveMacroVectorValue(expr, context, stack, macro);
        }
    }

    return {
        ok: false,
        value: [0.0, 0.0, 0.0]
    };
}

function resolveMacroNumberValue(expr, context, stack, macro) {
    let macroIndex = 0;
    let result = null;
    let scope = null;

    if (expr.args.length !== macro.params.length) {
        context.errors.push(
            "Macro '" + expr.name + "' expected "
            + macro.params.length + " arguments but received "
            + expr.args.length + "."
        );

        return {
            ok: false,
            value: 0.0
        };
    }

    for (macroIndex = 0; macroIndex < context.macroStack.length; macroIndex += 1) {
        if (context.macroStack[macroIndex] === macro.name) {
            context.errors.push("Recursive macro call involving '" + macro.name + "'.");

            return {
                ok: false,
                value: 0.0
            };
        }
    }

    scope = {
        names: macro.params,
        exprs: expr.args,
        capturedScopes: context.scopes.slice()
    };

    context.macroStack.push(macro.name);
    pushCompilerScope(context, scope);
    result = resolveNumberValue(macro.body, context, stack);
    context.scopes.pop();
    context.macroStack.pop();

    return result;
}

function resolveMacroVectorValue(expr, context, stack, macro) {
    let macroIndex = 0;
    let result = null;
    let scope = null;

    if (expr.args.length !== macro.params.length) {
        context.errors.push(
            "Macro '" + expr.name + "' expected "
            + macro.params.length + " arguments but received "
            + expr.args.length + "."
        );

        return {
            ok: false,
            value: [0.0, 0.0, 0.0]
        };
    }

    for (macroIndex = 0; macroIndex < context.macroStack.length; macroIndex += 1) {
        if (context.macroStack[macroIndex] === macro.name) {
            context.errors.push("Recursive macro call involving '" + macro.name + "'.");

            return {
                ok: false,
                value: [0.0, 0.0, 0.0]
            };
        }
    }

    scope = {
        names: macro.params,
        exprs: expr.args,
        capturedScopes: context.scopes.slice()
    };

    context.macroStack.push(macro.name);
    pushCompilerScope(context, scope);
    result = resolveVectorValue(macro.body, context, stack);
    context.scopes.pop();
    context.macroStack.pop();

    return result;
}

function resolveCapturedNumberValue(reference, context, stack) {
    let result = null;
    let savedScopes = null;

    if (!reference.capturedScopes) {
        return resolveNumberValue(reference.expr, context, stack);
    }

    savedScopes = context.scopes;
    context.scopes = reference.capturedScopes;
    result = resolveNumberValue(reference.expr, context, stack);
    context.scopes = savedScopes;

    return result;
}

function resolveCapturedVectorValue(reference, context, stack) {
    let result = null;
    let savedScopes = null;

    if (!reference.capturedScopes) {
        return resolveVectorValue(reference.expr, context, stack);
    }

    savedScopes = context.scopes;
    context.scopes = reference.capturedScopes;
    result = resolveVectorValue(reference.expr, context, stack);
    context.scopes = savedScopes;

    return result;
}

function resolveCapturedWrapperNumberValue(expr, context, stack) {
    let result = null;
    let savedScopes = context.scopes;

    context.scopes = expr.capturedScopes;
    result = resolveNumberValue(expr.expr, context, stack);
    context.scopes = savedScopes;

    return result;
}

function resolveCapturedWrapperVectorValue(expr, context, stack) {
    let result = null;
    let savedScopes = context.scopes;

    context.scopes = expr.capturedScopes;
    result = resolveVectorValue(expr.expr, context, stack);
    context.scopes = savedScopes;

    return result;
}

function resolvePrimitiveNumberValue(expr, context, stack, operation) {
    let index = 0;
    let value = null;
    let nextValue = null;

    if (operation === "abs") {
        if (expr.args.length !== 1) {
            return {
                ok: false,
                value: 0.0
            };
        }

        value = resolveNumberValue(expr.args[0], context, stack);

        return {
            ok: value.ok,
            value: Math.abs(value.value)
        };
    }

    if (operation === "div" || operation === "mod" || operation === "pow") {
        if (expr.args.length !== 2) {
            return {
                ok: false,
                value: 0.0
            };
        }

        value = resolveNumberValue(expr.args[0], context, stack);
        nextValue = resolveNumberValue(expr.args[1], context, stack);

        if (!value.ok || !nextValue.ok) {
            return {
                ok: false,
                value: 0.0
            };
        }

        if (operation === "div") {
            return {
                ok: true,
                value: value.value / nextValue.value
            };
        }

        if (operation === "mod") {
            return {
                ok: true,
                value: value.value - nextValue.value * Math.floor(value.value / nextValue.value)
            };
        }

        return {
            ok: true,
            value: Math.pow(value.value, nextValue.value)
        };
    }

    if (expr.args.length < 2) {
        return {
            ok: false,
            value: 0.0
        };
    }

    value = resolveNumberValue(expr.args[0], context, stack);

    if (!value.ok) {
        return {
            ok: false,
            value: 0.0
        };
    }

    for (index = 1; index < expr.args.length; index += 1) {
        nextValue = resolveNumberValue(expr.args[index], context, stack);

        if (!nextValue.ok) {
            return {
                ok: false,
                value: 0.0
            };
        }

        if (operation === "min") {
            value.value = Math.min(value.value, nextValue.value);
        }

        if (operation === "max") {
            value.value = Math.max(value.value, nextValue.value);
        }

        if (operation === "add") {
            value.value += nextValue.value;
        }

        if (operation === "mul") {
            value.value *= nextValue.value;
        }
    }

    return value;
}

function formatNumber(value) {
    let text = "";

    if (!Number.isFinite(value)) {
        return "0.0";
    }

    text = value.toFixed(6);
    text = text.replace(/0+$/g, "");

    if (text.charAt(text.length - 1) === ".") {
        text += "0";
    }

    if (text === "-0.0" || text === "-0") {
        text = "0.0";
    }

    if (text.indexOf(".") < 0) {
        text += ".0";
    }

    return text;
}

function copyErrors(target, source) {
    let index = 0;

    if (!source) {
        return;
    }

    for (index = 0; index < source.length; index += 1) {
        target.push(source[index]);
    }
}

function isShapeExpression(expr, parsed, stack, scopes, macroStack, shapeState) {
    let reference = null;
    let callName = "";
    let isShape = false;
    let resultIndex = -1;
    let macro = null;
    let macroIndex = 0;
    let scope = null;
    let selectedScopes = null;

    if (!expr) {
        return false;
    }

    if (expr.kind === "name") {
        reference = findShapeScopedAssignment(parsed, scopes, expr.name);

        if (!reference.found || stackContains(stack, reference.key)) {
            return false;
        }

        selectedScopes = scopes;

        if (reference.capturedScopes) {
            selectedScopes = reference.capturedScopes;
        }

        stack.push(reference.key);
        isShape = isShapeExpression(reference.expr, parsed, stack, selectedScopes, macroStack, shapeState);
        stack.pop();

        return isShape;
    }

    if (expr.kind === "captured") {
        return isShapeExpression(expr.expr, parsed, stack, expr.capturedScopes, macroStack, shapeState);
    }

    if (expr.kind === "block") {
        resultIndex = blockResultIndex(expr);

        if (resultIndex < 0) {
            return false;
        }

        assignShapeScopeId(expr, shapeState);
        scopes.push(expr);
        stack.push("s:" + expr.shapeScopeId + ":" + resultIndex);
        isShape = isShapeExpression(expr.exprs[resultIndex], parsed, stack, scopes, macroStack, shapeState);
        stack.pop();
        scopes.pop();

        return isShape;
    }

    if (expr.kind !== "call") {
        return false;
    }

    callName = expr.name.toLowerCase();

    if (isPrimitiveOperationName(callName)) {
        return false;
    }

    macro = findMacro(parsed, expr.name);

    if (macro) {
        for (macroIndex = 0; macroIndex < macroStack.length; macroIndex += 1) {
            if (macroStack[macroIndex] === macro.name) {
                return false;
            }
        }

        if (expr.args.length !== macro.params.length) {
            return false;
        }

        scope = {
            names: macro.params,
            exprs: expr.args,
            capturedScopes: scopes.slice()
        };

        macroStack.push(macro.name);
        assignShapeScopeId(scope, shapeState);
        scopes.push(scope);
        isShape = isShapeExpression(macro.body, parsed, stack, scopes, macroStack, shapeState);
        scopes.pop();
        macroStack.pop();

        return isShape;
    }

    return true;
}

function findAssignmentIndex(parsed, name) {
    let index = parsed.names.length - 1;

    while (index >= 0) {
        if (parsed.names[index] === name) {
            return index;
        }

        index -= 1;
    }

    return -1;
}

function findMacro(parsed, name) {
    let index = findMacroIndex(parsed, name);

    if (index < 0) {
        return null;
    }

    return parsed.macros[index];
}

function findMacroIndex(parsed, name) {
    let index = 0;

    if (!parsed.macros) {
        return -1;
    }

    for (index = parsed.macros.length - 1; index >= 0; index -= 1) {
        if (parsed.macros[index].name === name) {
            return index;
        }
    }

    return -1;
}

function findScopedAssignment(context, name) {
    let scopeIndex = context.scopes.length - 1;
    let assignmentIndex = -1;

    while (scopeIndex >= 0) {
        assignmentIndex = findNameIndex(context.scopes[scopeIndex].names, name);

        if (assignmentIndex >= 0) {
            return {
                found: true,
                key: "s:" + context.scopes[scopeIndex].scopeId + ":" + assignmentIndex,
                expr: context.scopes[scopeIndex].exprs[assignmentIndex],
                capturedScopes: context.scopes[scopeIndex].capturedScopes || null
            };
        }

        scopeIndex -= 1;
    }

    assignmentIndex = findAssignmentIndex(context.parsed, name);

    if (assignmentIndex >= 0) {
        return {
            found: true,
            key: "t:" + assignmentIndex,
            expr: context.parsed.exprs[assignmentIndex],
            capturedScopes: null
        };
    }

    return {
        found: false,
        key: "",
        expr: null,
        capturedScopes: null
    };
}

function findShapeScopedAssignment(parsed, scopes, name) {
    let scopeIndex = scopes.length - 1;
    let assignmentIndex = -1;

    while (scopeIndex >= 0) {
        assignmentIndex = findNameIndex(scopes[scopeIndex].names, name);

        if (assignmentIndex >= 0) {
            return {
                found: true,
                key: "s:" + scopes[scopeIndex].shapeScopeId + ":" + assignmentIndex,
                expr: scopes[scopeIndex].exprs[assignmentIndex],
                capturedScopes: scopes[scopeIndex].capturedScopes || null
            };
        }

        scopeIndex -= 1;
    }

    assignmentIndex = findAssignmentIndex(parsed, name);

    if (assignmentIndex >= 0) {
        return {
            found: true,
            key: "t:" + assignmentIndex,
            expr: parsed.exprs[assignmentIndex],
            capturedScopes: null
        };
    }

    return {
        found: false,
        key: "",
        expr: null,
        capturedScopes: null
    };
}

function blockResultIndex(block) {
    return block.resultIndex;
}

function pushCompilerScope(context, scope) {
    scope.scopeId = context.nextScopeId;
    context.nextScopeId += 1;
    context.scopes.push(scope);

    return scope.scopeId;
}

function assignShapeScopeId(scope, shapeState) {
    scope.shapeScopeId = shapeState.nextScopeId;
    shapeState.nextScopeId += 1;
}

function findNameIndex(names, name) {
    let index = names.length - 1;

    while (index >= 0) {
        if (names[index] === name) {
            return index;
        }

        index -= 1;
    }

    return -1;
}

function nameListContains(names, name) {
    return findNameIndex(names, name) >= 0;
}

function stackContains(stack, key) {
    let index = 0;

    for (index = 0; index < stack.length; index += 1) {
        if (stack[index] === key) {
            return true;
        }
    }

    return false;
}

function isBuiltInCallName(callName) {
    switch (callName) {
        case "for":
        case "to":
        case "in":
        case "step":
        case "color":
        case "union":
        case "intersect":
        case "subtract":
        case "smooth_union":
        case "smooth_intersect":
        case "smooth_subtract":
        case "chamfer_union":
        case "chamfer_intersect":
        case "chamfer_subtract":
        case "move":
        case "scale":
        case "rotate":
        case "round":
        case "shell":
            return true;
    }

    return isPrimitiveOperationName(callName) || isShapePrimitiveCallName(callName);
}

function isShapePrimitiveCallName(callName) {
    switch (callName) {
        case "sphere":
        case "box":
        case "rounded_box":
        case "box_frame":
        case "chamfer_box":
        case "cylinder":
        case "rounded_cylinder":
        case "chamfer_cylinder":
        case "tri_prism":
        case "hex_prism":
        case "octagon_prism":
        case "cone":
        case "rounded_cone":
        case "chamfer_cone":
        case "pyramid":
        case "octahedron":
        case "torus":
        case "capped_torus":
        case "capped_cylinder":
        case "capped_line":
        case "capped_cone":
            return true;
    }

    return false;
}

function boxSizeArgValue(expr, context, index) {
    let vectorResult = resolveVectorValue(expr.args[index], context, []);
    let numberResult = null;

    if (vectorResult.ok) {
        return vectorResult.value;
    }

    numberResult = resolveNumberValue(expr.args[index], context, []);

    if (numberResult.ok) {
        return [numberResult.value, numberResult.value, numberResult.value];
    }

    context.errors.push("Argument " + (index + 1) + " to '" + expr.name + "' must be a number or vector.");

    return [0.0, 0.0, 0.0];
}

function boundsVolumeSize(bounds) {
    let volumeSize = 0.0;

    if (typeof bounds === "number") {
        volumeSize = bounds;
    }

    if (bounds && typeof bounds === "object") {
        if (Number.isFinite(bounds.bound)) {
            volumeSize = bounds.bound;
        } else if (Number.isFinite(bounds.boundValue)) {
            volumeSize = bounds.boundValue;
        } else if (Number.isFinite(bounds.size)) {
            volumeSize = bounds.size;
        }
    }

    if (!Number.isFinite(volumeSize)) {
        return 0.0;
    }

    return Math.max(volumeSize, 0.0);
}

function generatedSdfHelperSource() {
    return [
        "function clampNumber(value, minValue, maxValue) {",
        "    return Math.min(Math.max(value, minValue), maxValue);",
        "}",
        "function positiveModuloValue(value, divisor) {",
        "    return value - divisor * Math.floor(value / divisor);",
        "}",
        "function sdSphere(x, y, z, radius) {",
        "    return Math.hypot(x, y, z) - radius;",
        "}",
        "function sdBox(x, y, z, hx, hy, hz) {",
        "    let dx = Math.abs(x) - hx;",
        "    let dy = Math.abs(y) - hy;",
        "    let dz = Math.abs(z) - hz;",
        "    let ox = Math.max(dx, 0.0);",
        "    let oy = Math.max(dy, 0.0);",
        "    let oz = Math.max(dz, 0.0);",
        "    return Math.hypot(ox, oy, oz) + Math.min(Math.max(dx, Math.max(dy, dz)), 0.0);",
        "}",
        "function sdBoxFrame(x, y, z, hx, hy, hz, thickness) {",
        "    let e = Math.max(thickness, 0.0);",
        "    let px = Math.abs(x) - hx;",
        "    let py = Math.abs(y) - hy;",
        "    let pz = Math.abs(z) - hz;",
        "    let qx = Math.abs(px + e) - e;",
        "    let qy = Math.abs(py + e) - e;",
        "    let qz = Math.abs(pz + e) - e;",
        "    let ax = Math.hypot(Math.max(px, 0.0), Math.max(qy, 0.0), Math.max(qz, 0.0)) + Math.min(Math.max(px, Math.max(qy, qz)), 0.0);",
        "    let ay = Math.hypot(Math.max(qx, 0.0), Math.max(py, 0.0), Math.max(qz, 0.0)) + Math.min(Math.max(qx, Math.max(py, qz)), 0.0);",
        "    let az = Math.hypot(Math.max(qx, 0.0), Math.max(qy, 0.0), Math.max(pz, 0.0)) + Math.min(Math.max(qx, Math.max(qy, pz)), 0.0);",
        "    return Math.min(Math.min(ax, ay), az);",
        "}",
        "function sdRoundedBox(x, y, z, hx, hy, hz, radius) {",
        "    let r = clampNumber(radius, 0.0, Math.min(hx, Math.min(hy, hz)));",
        "    return sdBox(x, y, z, hx - r, hy - r, hz - r) - r;",
        "}",
        "function sdChamferBox(x, y, z, hx, hy, hz, chamfer) {",
        "    let c = clampNumber(chamfer, 0.0, Math.min(hx, Math.min(hy, hz)));",
        "    let dx = Math.abs(x) - hx;",
        "    let dy = Math.abs(y) - hy;",
        "    let dz = Math.abs(z) - hz;",
        "    let d = sdBox(x, y, z, hx, hy, hz);",
        "    if (c > 0.0) {",
        "        d = Math.max(d, (dx + dy + c) * 0.70710678118);",
        "        d = Math.max(d, (dx + dz + c) * 0.70710678118);",
        "        d = Math.max(d, (dy + dz + c) * 0.70710678118);",
        "    }",
        "    return d;",
        "}",
        "function sdCylinder(x, y, z, radius, halfHeight) {",
        "    let qx = Math.hypot(x, y) - radius;",
        "    let qy = Math.abs(z) - halfHeight;",
        "    let ox = Math.max(qx, 0.0);",
        "    let oy = Math.max(qy, 0.0);",
        "    return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0.0);",
        "}",
        "function sdRoundedCylinder(x, y, z, radius, halfHeight, edgeRadius) {",
        "    let r = clampNumber(edgeRadius, 0.0, Math.min(radius, halfHeight));",
        "    return sdCylinder(x, y, z, radius - r, halfHeight - r) - r;",
        "}",
        "function sdChamferCylinder(x, y, z, radius, halfHeight, chamfer) {",
        "    let c = clampNumber(chamfer, 0.0, Math.min(radius, halfHeight));",
        "    let qx = Math.hypot(x, y) - radius;",
        "    let qy = Math.abs(z) - halfHeight;",
        "    let d = sdCylinder(x, y, z, radius, halfHeight);",
        "    if (c > 0.0) { d = Math.max(d, (qx + qy + c) * 0.70710678118); }",
        "    return d;",
        "}",
        "function sdTriPrism(x, y, z, radius, halfHeight) {",
        "    let prismRadius = Math.max(radius, 0.0001);",
        "    let h = prismRadius * 0.5 * Math.sqrt(3.0);",
        "    let px = Math.abs(x / h) - 1.0;",
        "    let py = y / h + 1.0 / Math.sqrt(3.0);",
        "    let d1 = 0.0;",
        "    let d2 = Math.abs(z) - Math.max(Math.abs(halfHeight), 0.0);",
        "    if (px + Math.sqrt(3.0) * py > 0.0) {",
        "        let oldPx = px;",
        "        px = (px - Math.sqrt(3.0) * py) * 0.5;",
        "        py = (-Math.sqrt(3.0) * oldPx - py) * 0.5;",
        "    }",
        "    px -= clampNumber(px, -2.0, 0.0);",
        "    d1 = Math.hypot(px, py) * Math.sign(-py) * h;",
        "    return Math.hypot(Math.max(d1, 0.0), Math.max(d2, 0.0)) + Math.min(Math.max(d1, d2), 0.0);",
        "}",
        "function sdHexPrism(x, y, z, radius, halfHeight) {",
        "    let prismRadius = Math.max(radius, 0.0);",
        "    let px = Math.abs(x);",
        "    let py = Math.abs(y);",
        "    let pz = Math.abs(z);",
        "    let dotValue = Math.min(-0.8660254 * px + 0.5 * py, 0.0);",
        "    let dx = 0.0;",
        "    let dy = 0.0;",
        "    let d0 = 0.0;",
        "    let d1 = 0.0;",
        "    px -= 2.0 * dotValue * -0.8660254;",
        "    py -= 2.0 * dotValue * 0.5;",
        "    dx = px - clampNumber(px, -0.57735 * prismRadius, 0.57735 * prismRadius);",
        "    dy = py - prismRadius;",
        "    d0 = Math.hypot(dx, dy) * Math.sign(py - prismRadius);",
        "    d1 = pz - Math.max(Math.abs(halfHeight), 0.0);",
        "    return Math.min(Math.max(d0, d1), 0.0) + Math.hypot(Math.max(d0, 0.0), Math.max(d1, 0.0));",
        "}",
        "function sdOctagonPrism(x, y, z, radius, halfHeight) {",
        "    let prismRadius = Math.max(radius, 0.0);",
        "    let px = Math.abs(x);",
        "    let py = Math.abs(y);",
        "    let pz = Math.abs(z);",
        "    let dotA = Math.min(-0.9238795325 * px + 0.3826834323 * py, 0.0);",
        "    let dotB = 0.0;",
        "    let d0 = 0.0;",
        "    let d1 = 0.0;",
        "    px -= 2.0 * dotA * -0.9238795325;",
        "    py -= 2.0 * dotA * 0.3826834323;",
        "    dotB = Math.min(0.9238795325 * px + 0.3826834323 * py, 0.0);",
        "    px -= 2.0 * dotB * 0.9238795325;",
        "    py -= 2.0 * dotB * 0.3826834323;",
        "    px -= clampNumber(px, -0.4142135623 * prismRadius, 0.4142135623 * prismRadius);",
        "    py -= prismRadius;",
        "    d0 = Math.hypot(px, py) * Math.sign(py);",
        "    d1 = pz - Math.max(Math.abs(halfHeight), 0.0);",
        "    return Math.min(Math.max(d0, d1), 0.0) + Math.hypot(Math.max(d0, 0.0), Math.max(d1, 0.0));",
        "}",
        "function coneValue(radial, z, height, baseRadius, topRadius) {",
        "    let safeHeight = Math.max(Math.abs(height), 0.0001);",
        "    let safeBaseRadius = Math.max(baseRadius, 0.0);",
        "    let safeTopRadius = Math.max(topRadius, 0.0);",
        "    let halfHeight = safeHeight * 0.5;",
        "    let qx = radial;",
        "    let qy = z - halfHeight;",
        "    let k1x = safeTopRadius;",
        "    let k1y = halfHeight;",
        "    let k2x = safeTopRadius - safeBaseRadius;",
        "    let k2y = safeHeight;",
        "    let capRadius = safeTopRadius;",
        "    let cax = 0.0;",
        "    let cay = Math.abs(qy) - halfHeight;",
        "    let cbx = 0.0;",
        "    let cby = 0.0;",
        "    let dotValue = 0.0;",
        "    let denominator = Math.max(k2x * k2x + k2y * k2y, 0.0001);",
        "    let t = 0.0;",
        "    let side = 1.0;",
        "    if (qy < 0.0) { capRadius = safeBaseRadius; }",
        "    cax = qx - Math.min(qx, capRadius);",
        "    dotValue = (k1x - qx) * k2x + (k1y - qy) * k2y;",
        "    t = clampNumber(dotValue / denominator, 0.0, 1.0);",
        "    cbx = qx - k1x + k2x * t;",
        "    cby = qy - k1y + k2y * t;",
        "    if (cbx < 0.0 && cay < 0.0) { side = -1.0; }",
        "    return side * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));",
        "}",
        "function coneSideDistance(radial, z, height, baseRadius, topRadius) {",
        "    let safeHeight = Math.max(Math.abs(height), 0.0001);",
        "    let safeBaseRadius = Math.max(baseRadius, 0.0);",
        "    let safeTopRadius = Math.max(topRadius, 0.0);",
        "    let slope = (safeTopRadius - safeBaseRadius) / safeHeight;",
        "    let sideScale = Math.sqrt(1.0 + slope * slope);",
        "    let clampedZ = clampNumber(z, 0.0, safeHeight);",
        "    let radiusAtZ = safeBaseRadius + slope * clampedZ;",
        "    return (radial - radiusAtZ) / sideScale;",
        "}",
        "function sdCone(x, y, z, height, baseRadius, topRadius) {",
        "    return coneValue(Math.hypot(x, y), z, height, baseRadius, topRadius);",
        "}",
        "function sdRoundedCone(x, y, z, height, baseRadius, topRadius, edgeRadius) {",
        "    let safeHeight = Math.max(Math.abs(height), 0.0001);",
        "    let safeBaseRadius = Math.max(baseRadius, 0.0);",
        "    let safeTopRadius = Math.max(topRadius, 0.0);",
        "    let radiusLimit = Math.min(safeHeight * 0.5, Math.max(safeBaseRadius, safeTopRadius));",
        "    let r = clampNumber(edgeRadius, 0.0, radiusLimit);",
        "    let slope = (safeTopRadius - safeBaseRadius) / safeHeight;",
        "    let sideScale = Math.sqrt(1.0 + slope * slope);",
        "    let innerBaseRadius = Math.max(safeBaseRadius + slope * r - r * sideScale, 0.0);",
        "    let innerTopRadius = Math.max(safeTopRadius - slope * r - r * sideScale, 0.0);",
        "    return coneValue(Math.sqrt(x * x + y * y), z - r, safeHeight - r * 2.0, innerBaseRadius, innerTopRadius) - r;",
        "}",
        "function sdChamferCone(x, y, z, height, baseRadius, topRadius, chamfer) {",
        "    let radial = Math.hypot(x, y);",
        "    let safeHeight = Math.max(Math.abs(height), 0.0001);",
        "    let safeBaseRadius = Math.max(baseRadius, 0.0);",
        "    let safeTopRadius = Math.max(topRadius, 0.0);",
        "    let c = clampNumber(chamfer, 0.0, Math.min(safeHeight * 0.5, Math.max(safeBaseRadius, safeTopRadius)));",
        "    let d = coneValue(radial, z, safeHeight, safeBaseRadius, safeTopRadius);",
        "    let side = coneSideDistance(radial, z, safeHeight, safeBaseRadius, safeTopRadius);",
        "    if (c > 0.0) {",
        "        d = Math.max(d, (side - z + c) * 0.70710678118);",
        "        d = Math.max(d, (side + z - safeHeight + c) * 0.70710678118);",
        "    }",
        "    return d;",
        "}",
        "function sdPyramid(x, y, z, height, baseSize) {",
        "    let h = Math.max(Math.abs(height), 0.0001);",
        "    let halfSize = Math.max(baseSize, 0.0) * 0.5;",
        "    let slope = halfSize / h;",
        "    let sideScale = Math.sqrt(1.0 + slope * slope);",
        "    let sideX = (Math.abs(x) + slope * z - halfSize) / sideScale;",
        "    let sideY = (Math.abs(y) + slope * z - halfSize) / sideScale;",
        "    return Math.max(-z, Math.max(sideX, sideY));",
        "}",
        "function sdOctahedron(x, y, z, size) {",
        "    let s = Math.max(size, 0.0);",
        "    let px = Math.abs(x);",
        "    let py = Math.abs(y);",
        "    let pz = Math.abs(z);",
        "    let m = px + py + pz - s;",
        "    let qx = px;",
        "    let qy = py;",
        "    let qz = pz;",
        "    let k = 0.0;",
        "    if (3.0 * px < m) {",
        "        qx = px;",
        "        qy = py;",
        "        qz = pz;",
        "    } else if (3.0 * py < m) {",
        "        qx = py;",
        "        qy = pz;",
        "        qz = px;",
        "    } else if (3.0 * pz < m) {",
        "        qx = pz;",
        "        qy = px;",
        "        qz = py;",
        "    } else {",
        "        return m * 0.57735027;",
        "    }",
        "    k = clampNumber(0.5 * (qz - qy + s), 0.0, s);",
        "    return Math.hypot(qx, qy - s + k, qz - k);",
        "}",
        "function sdTorus(x, y, z, majorRadius, minorRadius) {",
        "    let qx = Math.hypot(x, y) - majorRadius;",
        "    return Math.hypot(qx, z) - minorRadius;",
        "}",
        "function circularAngleDistance(a, b) {",
        "    let fullTurn = Math.PI * 2.0;",
        "    let halfTurn = Math.PI;",
        "    let delta = positiveModuloValue(a - b + halfTurn, fullTurn) - halfTurn;",
        "    return Math.abs(delta);",
        "}",
        "function nearestArcAngle(angle, startAngle, sweepAngle) {",
        "    let fullTurn = Math.PI * 2.0;",
        "    let sweep = clampNumber(Math.abs(sweepAngle), 0.0, fullTurn);",
        "    let relative = positiveModuloValue(angle - startAngle, fullTurn);",
        "    let endAngle = startAngle + sweep;",
        "    let startDistance = 0.0;",
        "    let endDistance = 0.0;",
        "    if (sweepAngle < 0.0) {",
        "        relative = positiveModuloValue(startAngle - angle, fullTurn);",
        "        endAngle = startAngle - sweep;",
        "    }",
        "    if (relative <= sweep) {",
        "        if (sweepAngle < 0.0) { return startAngle - relative; }",
        "        return startAngle + relative;",
        "    }",
        "    startDistance = circularAngleDistance(angle, startAngle);",
        "    endDistance = circularAngleDistance(angle, endAngle);",
        "    if (startDistance <= endDistance) { return startAngle; }",
        "    return endAngle;",
        "}",
        "function sdCappedTorus(x, y, z, majorRadius, minorRadius, startDegrees, sweepDegrees) {",
        "    let startAngle = startDegrees * Math.PI / 180.0;",
        "    let sweepAngle = sweepDegrees * Math.PI / 180.0;",
        "    let nearestAngle = nearestArcAngle(Math.atan2(y, x), startAngle, sweepAngle);",
        "    let nearestX = Math.cos(nearestAngle) * majorRadius;",
        "    let nearestY = Math.sin(nearestAngle) * majorRadius;",
        "    let qx = x - nearestX;",
        "    let qy = y - nearestY;",
        "    if (Math.abs(sweepAngle) >= Math.PI * 2.0 - 0.0001) {",
        "        qx = Math.hypot(x, y) - majorRadius;",
        "        qy = z;",
        "        return Math.hypot(qx, qy) - minorRadius;",
        "    }",
        "    return Math.hypot(qx, qy, z) - minorRadius;",
        "}",
        "function sdCappedCylinder(x, y, z, sx, sy, sz, ex, ey, ez, radius) {",
        "    let px = x - sx;",
        "    let py = y - sy;",
        "    let pz = z - sz;",
        "    let bx = ex - sx;",
        "    let by = ey - sy;",
        "    let bz = ez - sz;",
        "    let denominator = Math.max(bx * bx + by * by + bz * bz, 0.0001);",
        "    let h = clampNumber((px * bx + py * by + pz * bz) / denominator, 0.0, 1.0);",
        "    let qx = px - bx * h;",
        "    let qy = py - by * h;",
        "    let qz = pz - bz * h;",
        "    return Math.hypot(qx, qy, qz) - radius;",
        "}",
        "function sdCappedCone(x, y, z, sx, sy, sz, ex, ey, ez, startRadius, endRadius) {",
        "    let px = x - sx;",
        "    let py = y - sy;",
        "    let pz = z - sz;",
        "    let bx = ex - sx;",
        "    let by = ey - sy;",
        "    let bz = ez - sz;",
        "    let safeStartRadius = Math.max(startRadius, 0.0);",
        "    let safeEndRadius = Math.max(endRadius, 0.0);",
        "    let radiusDelta = safeEndRadius - safeStartRadius;",
        "    let baba = Math.max(bx * bx + by * by + bz * bz, 0.0001);",
        "    let papa = px * px + py * py + pz * pz;",
        "    let paba = (px * bx + py * by + pz * bz) / baba;",
        "    let radial = Math.sqrt(Math.max(papa - paba * paba * baba, 0.0));",
        "    let capX = 0.0;",
        "    let capY = Math.abs(paba - 0.5) - 0.5;",
        "    let k = radiusDelta * radiusDelta + baba;",
        "    let f = clampNumber((radiusDelta * (radial - safeStartRadius) + paba * baba) / k, 0.0, 1.0);",
        "    let sideX = radial - safeStartRadius - f * radiusDelta;",
        "    let sideY = paba - f;",
        "    let signValue = 1.0;",
        "    if (paba < 0.5) {",
        "        capX = Math.max(0.0, radial - safeStartRadius);",
        "    } else {",
        "        capX = Math.max(0.0, radial - safeEndRadius);",
        "    }",
        "    if (sideX < 0.0 && capY < 0.0) { signValue = -1.0; }",
        "    return signValue * Math.sqrt(Math.min(capX * capX + capY * capY * baba, sideX * sideX + sideY * sideY * baba));",
        "}",
        "function smoothUnion(a, b, radius) {",
        "    let safeRadius = Math.max(radius, 0.0001);",
        "    let h = Math.max(safeRadius - Math.abs(a - b), 0.0) / safeRadius;",
        "    return Math.min(a, b) - h * h * h * safeRadius * 0.1666667;",
        "}",
        "function chamferUnion(a, b, radius) {",
        "    return Math.min(Math.min(a, b), (a + b - radius) * 0.70710678118);",
        "}",
        "function chamferIntersect(a, b, radius) {",
        "    return Math.max(Math.max(a, b), (a + b + radius) * 0.70710678118);",
        "}"
    ].join("\n");
}
