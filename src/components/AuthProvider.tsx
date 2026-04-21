import React, { createContext, useContext, useState, useEffect } from 'react';

interface AuthContextType {
    isAuthenticated: boolean;
    login: () => Promise<void>;
    logout: () => Promise<void>;
    checkStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    const checkStatus = async () => {
        try {
            const res = await fetch('/api/auth/status');
            const data = await res.json();
            setIsAuthenticated(data.isAuthenticated);
        } catch (error) {
            console.error('Auth status check failed:', error);
            setIsAuthenticated(false);
        }
    };

    useEffect(() => {
        checkStatus();

        const handleMessage = async (event: MessageEvent) => {
            if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
                console.log('OAuth success message received, claiming session...');
                try {
                    // Force a claim to link the session
                    await fetch('/api/auth/claim', { method: 'POST' });
                    await checkStatus();
                } catch (err) {
                    console.error('Manual claim failed:', err);
                    await checkStatus();
                }
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const login = async () => {
        const res = await fetch('/api/auth/url');
        const { url } = await res.json();
        window.open(url, 'gmail_auth', 'width=600,height=700');
    };

    const logout = async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        setIsAuthenticated(false);
    };

    return (
        <AuthContext.Provider value={{ isAuthenticated, login, logout, checkStatus }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within an AuthProvider');
    return context;
}
