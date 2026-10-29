using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HotelManagementAPI.Migrations
{
    /// <inheritdoc />
    public partial class AddServiceUsageIdempotency : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ServiceUsageOperations",
                columns: table => new
                {
                    RequestId = table.Column<string>(type: "TEXT", maxLength: 36, nullable: false),
                    BookingId = table.Column<int>(type: "INTEGER", nullable: false),
                    ServiceId = table.Column<int>(type: "INTEGER", nullable: false),
                    Quantity = table.Column<int>(type: "INTEGER", nullable: false),
                    ServiceName = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    UsageId = table.Column<int>(type: "INTEGER", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ServiceUsageOperations", x => x.RequestId);
                    table.ForeignKey(
                        name: "FK_ServiceUsageOperations_ServiceUsages_UsageId",
                        column: x => x.UsageId,
                        principalTable: "ServiceUsages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ServiceUsageOperations_UsageId",
                table: "ServiceUsageOperations",
                column: "UsageId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ServiceUsageOperations");
        }
    }
}
