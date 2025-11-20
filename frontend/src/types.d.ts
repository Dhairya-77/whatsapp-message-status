declare module 'jspdf' {
  const jsPDF: any
  export default jsPDF
}

declare module 'jspdf-autotable' {
  const autoTable: (doc: any, options: any) => void
  export default autoTable
}
