using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HotelManagementAPI.Migrations
{
    /// <inheritdoc />
    public partial class AddBookingHoldsAndNotificationReads : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "HoldExpiredAtUtc",
                table: "Bookings",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "PaymentDueAtUtc",
                table: "Bookings",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CustomerNotificationReads",
                columns: table => new
                {
                    CustomerId = table.Column<int>(type: "INTEGER", nullable: false),
                    EventKey = table.Column<string>(type: "TEXT", maxLength: 80, nullable: false),
                    ReadAtUtc = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CustomerNotificationReads", x => new { x.CustomerId, x.EventKey });
                    table.ForeignKey(
                        name: "FK_CustomerNotificationReads_Customers_CustomerId",
                        column: x => x.CustomerId,
                        principalTable: "Customers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Bookings_Status_PaymentDueAtUtc",
                table: "Bookings",
                columns: new[] { "Status", "PaymentDueAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CustomerNotificationReads");

            migrationBuilder.DropIndex(
                name: "IX_Bookings_Status_PaymentDueAtUtc",
                table: "Bookings");

            migrationBuilder.DropColumn(
                name: "HoldExpiredAtUtc",
                table: "Bookings");

            migrationBuilder.DropColumn(
                name: "PaymentDueAtUtc",
                table: "Bookings");
        }
    }
}
