using System.Drawing;
namespace HotelManagement.WinForms;
internal static class Ui
{
    public static readonly Color Green=Color.FromArgb(20,57,47),Gold=Color.FromArgb(178,132,54),Paper=Color.FromArgb(245,246,242),Ink=Color.FromArgb(35,49,46);
    public static Button Button(string text,Action? click=null)
    {
        var b=new Button{Text=text,AutoSize=true,MinimumSize=new Size(100,37),Padding=new Padding(10,4,10,4),BackColor=Green,ForeColor=Color.White,FlatStyle=FlatStyle.Flat,Cursor=Cursors.Hand,Margin=new Padding(4)};
        b.FlatAppearance.BorderSize=0;if(click is not null)b.Click+=(_,_)=>click();return b;
    }
    public static Label Label(string text,int size=10,bool bold=false)=>new(){Text=text,AutoSize=true,Font=new Font("Segoe UI",size,bold?FontStyle.Bold:FontStyle.Regular),ForeColor=Ink,Margin=new Padding(4,8,4,6)};
    public static TextBox Input(bool secret=false)=>new(){Width=350,UseSystemPasswordChar=secret,Margin=new Padding(4,0,4,8)};
    public static FlowLayoutPanel Stack()=>new(){AutoSize=true,FlowDirection=FlowDirection.TopDown,WrapContents=false,Padding=new Padding(20),Dock=DockStyle.Fill,AutoScroll=true,BackColor=Paper};
    public static void Error(IWin32Window owner,Exception e)=>MessageBox.Show(owner,e.Message,"Không thực hiện được",MessageBoxButtons.OK,MessageBoxIcon.Warning);
    public static bool Confirm(IWin32Window owner,string text)=>MessageBox.Show(owner,text,"Xác nhận thao tác",MessageBoxButtons.YesNo,MessageBoxIcon.Question)==DialogResult.Yes;
    public static DataGridView Grid()=>new(){Dock=DockStyle.Fill,ReadOnly=true,AllowUserToAddRows=false,AllowUserToDeleteRows=false,AutoSizeColumnsMode=DataGridViewAutoSizeColumnsMode.Fill,SelectionMode=DataGridViewSelectionMode.FullRowSelect,MultiSelect=false,RowHeadersVisible=false,BackgroundColor=Color.White,BorderStyle=BorderStyle.None,AutoGenerateColumns=true,RowTemplate={Height=35}};
}
