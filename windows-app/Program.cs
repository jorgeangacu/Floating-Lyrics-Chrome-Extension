namespace FloatingLyrics;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        // Una sola instancia: si ya está abierta, la nueva se cierra.
        using var mutex = new Mutex(true, "FloatingLyrics.SingleInstance", out bool isFirst);
        if (!isFirst)
        {
            MessageBox.Show("Letras Flotantes ya está abierta.\nBúscala en la bandeja del sistema (junto al reloj) o pulsa Ctrl+Alt+L.",
                "Letras Flotantes", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}
