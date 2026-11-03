// What the rules throw when they turn an action down ("not your hero", "It costs 2500 gold."): the
// player's or the AI's mistake, shown to them. Any other error thrown inside the rules is a bug,
// which the fuzzer and the simulations report as one.
export class Refusal extends Error {
  override name = "Refusal";
}
