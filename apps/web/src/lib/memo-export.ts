/** Browser print dialog — save as PDF for RIA / personal records. */
export function printResearchMemo(title = 'Investment memo') {
  const prev = document.title;
  document.title = title;
  window.print();
  window.setTimeout(() => {
    document.title = prev;
  }, 500);
}
