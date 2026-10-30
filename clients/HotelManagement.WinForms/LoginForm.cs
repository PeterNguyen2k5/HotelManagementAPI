using HotelManagement.Client;
namespace HotelManagement.WinForms;
internal sealed class LoginForm:Form
{
    public HotelApiClient? Api{get;private set;}
    public LoginForm(string url)
    {
        Text="An Nhiên • Đăng nhập nhân viên";ClientSize=new(465,510);MinimumSize=Size;StartPosition=FormStartPosition.CenterScreen;Font=new("Segoe UI",10);BackColor=Ui.Paper;
        var panel=Ui.Stack();Controls.Add(panel);
        panel.Controls.Add(Ui.Label("AN NHIÊN",24,true));panel.Controls.Add(Ui.Label("Không gian làm việc cho lễ tân & quản trị",11));
        var server=Ui.Input();server.Text=url;var user=Ui.Input();var password=Ui.Input(true);
        panel.Controls.Add(Ui.Label("Địa chỉ API"));panel.Controls.Add(server);panel.Controls.Add(Ui.Label("Tên đăng nhập nhân viên"));panel.Controls.Add(user);panel.Controls.Add(Ui.Label("Mật khẩu"));panel.Controls.Add(password);
        var status=Ui.Label("Tài khoản dùng chung với trang quản trị web.");status.MaximumSize=new(390,0);panel.Controls.Add(status);
        var submit=Ui.Button("Đăng nhập");panel.Controls.Add(submit);AcceptButton=submit;
        submit.Click+=async(_,_)=>
        {
            submit.Enabled=false;HotelApiClient? candidate=null;
            try
            {
                candidate=new HotelApiClient(server.Text.Trim());
                var session=await candidate.Login(user.Text,password.Text,true);password.Clear();
                if(session.User!.MustChangePassword)
                {
                    using var change=new ChangePasswordForm(candidate);
                    change.ShowDialog(this);candidate.Dispose();candidate=null;
                    status.Text="Tài khoản yêu cầu đổi mật khẩu lần đầu. Sau khi đổi, hãy đăng nhập lại.";return;
                }
                Api=candidate;candidate=null;DialogResult=DialogResult.OK;Close();
            }
            catch(Exception e){status.Text=e.Message;}
            finally{candidate?.Dispose();submit.Enabled=true;}
        };
    }
}

internal sealed class ChangePasswordForm:Form
{
    public ChangePasswordForm(HotelApiClient api)
    {
        Text="Đổi mật khẩu nhân viên";ClientSize=new(450,350);StartPosition=FormStartPosition.CenterParent;Font=new("Segoe UI",10);
        var p=Ui.Stack();Controls.Add(p);var old=Ui.Input(true);var next=Ui.Input(true);var confirm=Ui.Input(true);
        p.Controls.Add(Ui.Label("Mật khẩu hiện tại"));p.Controls.Add(old);p.Controls.Add(Ui.Label("Mật khẩu mới (lần đầu: ít nhất 12 ký tự)"));p.Controls.Add(next);p.Controls.Add(Ui.Label("Nhập lại mật khẩu mới"));p.Controls.Add(confirm);
        var save=Ui.Button("Đổi mật khẩu");p.Controls.Add(save);
        save.Click+=async(_,_)=>{save.Enabled=false;try{if(next.Text!=confirm.Text)throw new ApiException("Mật khẩu nhập lại chưa khớp.");await api.ChangeStaffPassword(old.Text,next.Text);DialogResult=DialogResult.OK;Close();}catch(Exception e){Ui.Error(this,e);}finally{save.Enabled=true;}};
    }
}
