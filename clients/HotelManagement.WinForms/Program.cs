using HotelManagement.Client;
namespace HotelManagement.WinForms;
internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var url=args.FirstOrDefault()??HotelApiClient.ProductionUrl;
        while(true)
        {
            using var login=new LoginForm(url);
            if(login.ShowDialog()!=DialogResult.OK||login.Api is null)break;
            using var api=login.Api;url=api.BaseAddress.ToString();
            using var main=new MainForm(api);Application.Run(main);
            if(!main.ReturnToLogin)break;
        }
    }
}
