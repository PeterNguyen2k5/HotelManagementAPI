using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HotelManagementAPI.Migrations
{
    /// <inheritdoc />
    public partial class AddBankPaymentOperations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BankPaymentOperations",
                columns: table => new
                {
                    RequestId = table.Column<string>(type: "TEXT", maxLength: 36, nullable: false),
                    Fingerprint = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    PaymentId = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BankPaymentOperations", x => x.RequestId);
                    table.ForeignKey(
                        name: "FK_BankPaymentOperations_BookingPayments_PaymentId",
                        column: x => x.PaymentId,
                        principalTable: "BookingPayments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BankPaymentOperations_PaymentId",
                table: "BankPaymentOperations",
                column: "PaymentId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BankPaymentOperations");
        }
    }
}
