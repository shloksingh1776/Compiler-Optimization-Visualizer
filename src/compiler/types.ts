/** Types supported by the MiniC language. */
export type MiniCType = 'int' | 'float' | 'bool';
/** Function return types include void; variables and expressions use MiniCType only. */
export type FunctionReturnType = MiniCType | 'void';
