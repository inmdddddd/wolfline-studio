(() => {
  const blockedKeys = new Set(["F12"]);
  const blockedCombos = [
    (event) => event.ctrlKey && event.shiftKey && ["I", "J", "C"].includes(event.key.toUpperCase()),
    (event) => event.ctrlKey && event.key.toUpperCase() === "U",
    (event) => event.ctrlKey && event.key.toUpperCase() === "S"
  ];

  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  document.addEventListener("keydown", (event) => {
    if (blockedKeys.has(event.key) || blockedCombos.some((combo) => combo(event))) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
})();
