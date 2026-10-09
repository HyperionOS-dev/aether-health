import { createContext, useContext } from "react";

export const AuthContext = createContext();

export function useAuth() {
	const context = useContext(AuthContext);
	if (!context) throw new Error("useAuth must be used within an AuthProvider");
	return context;
}