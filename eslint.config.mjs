import eslint from "@electron-toolkit/eslint-config";
import eslintConfigPrettier from "@electron-toolkit/eslint-config-prettier";

export default [
    {
        ignores: ["**/node_modules", "**/dist"]
    },
    eslint,
    eslintConfigPrettier
];
