import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'

type Theme = 'dark' | 'light'

interface ThemeContextType {
 theme: Theme
 toggle: () => void
}

const ThemeContext = createContext<ThemeContextType>({ theme: 'dark', toggle: () => {} })

export function useTheme() {
 return useContext(ThemeContext)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
 const [theme, setTheme] = useState<Theme>(() => {
 const saved = localStorage.getItem('rtm-theme')
 return (saved === 'light' ? 'light' : 'dark') as Theme
 })

 const toggle = useCallback(() => {
 setTheme(t => {
 const next = t === 'dark' ? 'light' : 'dark'
 localStorage.setItem('rtm-theme', next)
 return next
 })
 }, [])

 useEffect(() => {
 document.documentElement.setAttribute('data-theme', theme)
 }, [theme])

 const value = useMemo(() => ({ theme, toggle }), [theme, toggle])

 return (
 <ThemeContext.Provider value={value}>
 {children}
 </ThemeContext.Provider>
 )
}
