/** Allow TypeScript to accept CSS side-effect imports (e.g. import './index.css') */
declare module '*.css' {
  const styles: Record<string, string>
  export default styles
}
