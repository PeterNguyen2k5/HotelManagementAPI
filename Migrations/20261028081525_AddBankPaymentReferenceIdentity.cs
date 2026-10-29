using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HotelManagementAPI.Migrations
{
    /// <inheritdoc />
    public partial class AddBankPaymentReferenceIdentity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BankReferenceKey",
                table: "BookingPayments",
                type: "TEXT",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BankReferenceKey",
                table: "BankTransfers",
                type: "TEXT",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_BookingPayments_BankReferenceKey",
                table: "BookingPayments",
                column: "BankReferenceKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BankTransfers_BankReferenceKey",
                table: "BankTransfers",
                column: "BankReferenceKey");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_BookingPayments_BankReferenceKey",
                table: "BookingPayments");

            migrationBuilder.DropIndex(
                name: "IX_BankTransfers_BankReferenceKey",
                table: "BankTransfers");

            migrationBuilder.DropColumn(
                name: "BankReferenceKey",
                table: "BookingPayments");

            migrationBuilder.DropColumn(
                name: "BankReferenceKey",
                table: "BankTransfers");
        }
    }
}
