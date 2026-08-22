import type { Component } from "solid-js";
import logoUrl from "../assets/code-engine-logo.png";

export const AppLogo: Component = () => (
  <img src={logoUrl} alt="" aria-hidden="true" draggable={false} />
);
