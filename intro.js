const becaIntro = document.querySelector("#becaIntro");

if (becaIntro) {
  window.setTimeout(() => {
    becaIntro.classList.add("is-done");
  }, 4100);

  window.setTimeout(() => {
    becaIntro.remove();
  }, 5100);
}
