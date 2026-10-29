FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY HotelManagementAPI.csproj ./
RUN dotnet restore HotelManagementAPI.csproj
COPY . ./
RUN dotnet publish HotelManagementAPI.csproj -c Release --no-restore -o /out /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /out ./
RUN mkdir -p /var/lib/hotel && chown app:app /var/lib/hotel
ENV ASPNETCORE_HTTP_PORTS=8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    Storage__DataDirectory=/var/lib/hotel \
    Payments__BankConfigFile=/var/lib/hotel/bank-config.json
EXPOSE 8080
USER $APP_UID
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD ["dotnet", "HotelManagementAPI.dll", "--healthcheck"]
ENTRYPOINT ["dotnet", "HotelManagementAPI.dll"]
