import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import "../../lib/i18n";
import { useAppStore } from "../../store/app.store";
import { ShortcutsHelp } from "./ShortcutsHelp";

describe("ShortcutsHelp", () => {
  beforeEach(() => {
    useAppStore.setState({ isShortcutsHelpOpen: false });
  });

  it("ne rend rien quand l'aide est fermée", () => {
    const { container } = render(<ShortcutsHelp />);
    expect(container).toBeEmptyDOMElement();
  });

  it("affiche les raccourcis essentiels", () => {
    useAppStore.setState({ isShortcutsHelpOpen: true });
    render(<ShortcutsHelp />);

    expect(screen.getByText("Raccourcis clavier")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+L")).toBeInTheDocument();
    expect(screen.getByText("Appeler le suivant")).toBeInTheDocument();
  });

  it("se ferme au clic sur le bouton Fermer", async () => {
    useAppStore.setState({ isShortcutsHelpOpen: true });
    render(<ShortcutsHelp />);

    await userEvent.click(screen.getByRole("button", { name: "Fermer" }));

    expect(useAppStore.getState().isShortcutsHelpOpen).toBe(false);
  });
});
